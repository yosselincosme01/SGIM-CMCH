"""
Consultas de incidencias según los permisos del usuario.

Todas las reglas de acceso por área pasan por este módulo (ADR 0004):

- Cualquier usuario consulta las incidencias que él mismo registró.
- Un **Planificador** (rol ``planificador``) ve y gestiona solo las incidencias de las
  áreas activas donde su pertenencia tiene ``can_plan=True``.
- Un técnico (rol ``personal_atencion``) ve las incidencias de las áreas activas donde
  su pertenencia tiene ``can_be_assigned=True``.
- El rol global sin la función en el área no da acceso, y la función en el área sin
  el rol tampoco. No hay acceso entre áreas ni acceso global del administrador o del
  superusuario. La UPS del ticket no interviene en los permisos.
"""

from django.contrib.auth import get_user_model
from django.db.models import Count, Exists, Min, OuterRef, Prefetch, Q, QuerySet

from apps.accounts.roles import Role, has_role

from .models import (
    Incident,
    IncidentAssignment,
    IncidentAttachment,
    SupportArea,
    SupportAreaMembership,
)

PLANNABLE_STATUSES = (Incident.Status.REGISTRADA, Incident.Status.ASIGNADA)


# --- Áreas por función ------------------------------------------------------


def planning_areas(user) -> QuerySet[SupportArea]:
    """Áreas activas que el usuario puede planificar (rol + función en el área)."""
    if not has_role(user, Role.PLANIFICADOR):
        return SupportArea.objects.none()
    return SupportArea.objects.filter(
        is_active=True, memberships__user=user, memberships__can_plan=True
    )


def technician_areas(user) -> QuerySet[SupportArea]:
    """Áreas activas donde el usuario es técnico autorizado (rol + función en el área)."""
    if not has_role(user, Role.PERSONAL_ATENCION):
        return SupportArea.objects.none()
    return SupportArea.objects.filter(
        is_active=True, memberships__user=user, memberships__can_be_assigned=True
    )


def staff_area_ids(user) -> set[int]:
    """Áreas donde el usuario tiene alguna función (Planificador o técnico)."""
    ids = set(planning_areas(user).values_list("id", flat=True))
    ids.update(technician_areas(user).values_list("id", flat=True))
    return ids


def can_plan_area(user, area: SupportArea) -> bool:
    return planning_areas(user).filter(pk=area.pk).exists()


def can_view_area_inbox(user) -> bool:
    return bool(staff_area_ids(user))


def can_view_as_staff(user, incident: Incident) -> bool:
    """Ve la incidencia como personal del área (datos internos incluidos)."""
    return incident.support_area_id in staff_area_ids(user)


# --- Incidencias ------------------------------------------------------------


def base_queryset() -> QuerySet[Incident]:
    return Incident.objects.select_related("care_unit", "support_area", "created_by", "priority")


def own_incidents(user) -> QuerySet[Incident]:
    return base_queryset().filter(created_by=user)


def area_incidents(user) -> QuerySet[Incident]:
    """Incidencias de las áreas donde el usuario tiene una función autorizada."""
    return base_queryset().filter(support_area_id__in=staff_area_ids(user))


def visible_incidents(user) -> QuerySet[Incident]:
    """Todo lo que el usuario puede ver en detalle: las propias y las de sus áreas."""
    return base_queryset().filter(Q(created_by=user) | Q(support_area_id__in=staff_area_ids(user)))


def current_assignment_prefetch() -> Prefetch:
    return Prefetch(
        "assignments",
        queryset=IncidentAssignment.objects.filter(is_current=True).select_related(
            "technician", "assigned_by"
        ),
        to_attr="current_assignments",
    )


def planning_incidents(user) -> QuerySet[Incident]:
    """Bandeja del Planificador: solo las incidencias de sus áreas autorizadas."""
    return (
        base_queryset()
        .filter(support_area__in=planning_areas(user))
        .annotate(
            has_attachments_flag=Exists(IncidentAttachment.objects.filter(incident=OuterRef("pk")))
        )
        .prefetch_related(current_assignment_prefetch())
    )


def current_assignment(incident: Incident) -> IncidentAssignment | None:
    prefetched = getattr(incident, "current_assignments", None)
    if prefetched is not None:
        return prefetched[0] if prefetched else None
    return (
        incident.assignments.filter(is_current=True)
        .select_related("technician", "assigned_by")
        .first()
    )


# --- Técnicos ---------------------------------------------------------------


def assignable_technicians(area: SupportArea):
    """
    Técnicos autorizados del área: usuarios activos con el rol ``personal_atencion``
    explícito y ``can_be_assigned=True`` en esa área. Incluye su carga vigente.
    """
    user_model = get_user_model()
    authorized = SupportAreaMembership.objects.filter(
        area=area, user=OuterRef("pk"), can_be_assigned=True
    )
    current = Q(
        incident_assignments__is_current=True,
        incident_assignments__incident__status=Incident.Status.ASIGNADA,
    )
    return (
        user_model.objects.filter(is_active=True, groups__name=Role.PERSONAL_ATENCION)
        .filter(Exists(authorized))
        .annotate(
            active_assignments=Count("incident_assignments", filter=current, distinct=True),
            next_scheduled_at=Min("incident_assignments__scheduled_at", filter=current),
        )
        .order_by("first_name", "last_name", "username")
    )


def is_assignable_technician(user, area: SupportArea) -> bool:
    return user is not None and assignable_technicians(area).filter(pk=user.pk).exists()
