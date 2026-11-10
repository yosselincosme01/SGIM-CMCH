"""
Consultas de incidencias según los permisos del usuario.

Todas las reglas de acceso por área pasan por este módulo (ADR 0004):

- Toda cuenta operativa activa (con un rol Solicitante, Planificador o Personal de
  atención) consulta las incidencias que ella misma registró, y solo esas (ADR 0008).
- Cada función se concede **por área** y es independiente de las demás (ADR 0008):
  - planificar: rol ``planificador`` y ``can_plan=True``;
  - recibir asignaciones y registrar atenciones: rol ``personal_atencion`` y
    ``can_be_assigned=True``;
  - verificar conformidad: ``can_verify=True`` en una cuenta operativa activa, **sin**
    exigir el rol Planificador ni ``can_plan``. Nadie verifica el cierre de una
    intervención que ejecutó (separación de funciones).
- El personal ve en detalle las incidencias de las áreas donde tiene alguna función.
- El rol global sin la función en el área no da acceso, y la función en el área sin
  el rol tampoco. No hay acceso entre áreas ni acceso global del administrador o del
  superusuario. La UPS del ticket no interviene en los permisos. La vista que el
  usuario elige en la interfaz tampoco: el backend evalúa siempre todas sus funciones.
"""

from django.contrib.auth import get_user_model
from django.db.models import (
    BooleanField,
    Case,
    Count,
    Exists,
    Min,
    OuterRef,
    Prefetch,
    Q,
    QuerySet,
    Subquery,
    Value,
    When,
)

from apps.accounts.roles import Role, has_role, is_operational

from .models import (
    Incident,
    IncidentAssignment,
    IncidentAttachment,
    SupportArea,
    SupportAreaMembership,
)

# Estados en los que el Planificador puede priorizar y programar (ADR 0006).
PLANNABLE_STATUSES = (
    Incident.Status.REGISTRADA,
    Incident.Status.ASIGNADA,
    Incident.Status.REABIERTA,
)


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


def verification_areas(user) -> QuerySet[SupportArea]:
    """
    Áreas activas donde el usuario verifica conformidad: ``can_verify=True`` en una
    cuenta operativa activa (ADR 0008). No exige el rol Planificador ni ``can_plan``.
    Las cuentas sin rol operativo (solo administrativas, superusuarios o staff sin rol)
    no verifican aunque tengan la pertenencia.
    """
    if not is_operational(user):
        return SupportArea.objects.none()
    return SupportArea.objects.filter(
        is_active=True, memberships__user=user, memberships__can_verify=True
    )


def staff_area_ids(user) -> set[int]:
    """Áreas donde el usuario tiene alguna función (planificar, verificar o técnico)."""
    ids = set(planning_areas(user).values_list("id", flat=True))
    ids.update(verification_areas(user).values_list("id", flat=True))
    ids.update(technician_areas(user).values_list("id", flat=True))
    return ids


def can_plan_area(user, area: SupportArea) -> bool:
    return planning_areas(user).filter(pk=area.pk).exists()


def can_verify_area(user, area: SupportArea) -> bool:
    return verification_areas(user).filter(pk=area.pk).exists()


def can_use_review_inbox(user) -> bool:
    """
    Puede abrir la bandeja del Planificador (endpoints existentes): por su rol
    Planificador o por tener la función de verificar en algún área.
    """
    return has_role(user, Role.PLANIFICADOR) or verification_areas(user).exists()


def effective_capabilities(user) -> dict[str, bool]:
    """Funciones efectivas del usuario en alguna área, para que la interfaz se adapte."""
    return {
        "can_plan": planning_areas(user).exists(),
        "can_attend": technician_areas(user).exists(),
        "can_verify": verification_areas(user).exists(),
    }


def effective_area_functions(user) -> list[dict]:
    """
    Funciones efectivas por área activa (ADR 0009): solo las que el usuario puede
    ejercer de verdad (con el rol o la cuenta operativa que cada una exige).
    """
    plan = set(planning_areas(user).values_list("code", flat=True))
    attend = set(technician_areas(user).values_list("code", flat=True))
    verify = set(verification_areas(user).values_list("code", flat=True))
    codes = plan | attend | verify
    return [
        {
            "area": area.code,
            "area_name": area.name,
            "can_plan": area.code in plan,
            "can_attend": area.code in attend,
            "can_verify": area.code in verify,
        }
        for area in SupportArea.objects.filter(code__in=codes).order_by("name")
    ]


def can_reopen_area(user, area: SupportArea) -> bool:
    """Reabre un cierre No conforme quien planifica o verifica en el área."""
    return can_plan_area(user, area) or can_verify_area(user, area)


def can_view_area_inbox(user) -> bool:
    return bool(staff_area_ids(user))


def can_view_as_staff(user, incident: Incident) -> bool:
    """Ve la incidencia como personal del área (datos internos incluidos)."""
    return incident.support_area_id in staff_area_ids(user)


# --- Incidencias ------------------------------------------------------------


def base_queryset() -> QuerySet[Incident]:
    return Incident.objects.select_related("care_unit", "support_area", "created_by", "priority")


def own_incidents(user) -> QuerySet[Incident]:
    """Incidencias registradas por el usuario. Requiere una cuenta operativa activa."""
    if not is_operational(user):
        return Incident.objects.none()
    return base_queryset().filter(created_by=user)


def area_incidents(user) -> QuerySet[Incident]:
    """Incidencias de las áreas donde el usuario tiene una función autorizada."""
    return base_queryset().filter(support_area_id__in=staff_area_ids(user))


def visible_incidents(user) -> QuerySet[Incident]:
    """Todo lo que el usuario puede ver en detalle: las propias y las de sus áreas."""
    visible = Q(support_area_id__in=staff_area_ids(user))
    if is_operational(user):
        visible |= Q(created_by=user)
    return base_queryset().filter(visible)


def current_assignment_prefetch() -> Prefetch:
    return Prefetch(
        "assignments",
        queryset=IncidentAssignment.objects.filter(is_current=True).select_related(
            "technician", "assigned_by"
        ),
        to_attr="current_assignments",
    )


def pending_verification_expression():
    """True si la incidencia está cerrada y su cierre vigente no tiene verificación."""
    from .models import IncidentVerification

    verified = IncidentVerification.objects.filter(
        closing_intervention_id=OuterRef("closing_intervention_id")
    )
    return Case(
        When(~Q(status=Incident.Status.CERRADA), then=Value(False)),
        When(Exists(verified), then=Value(False)),
        default=Value(True),
        output_field=BooleanField(),
    )


def planning_incidents(user) -> QuerySet[Incident]:
    """
    Bandeja del Planificador: todas las incidencias de las áreas que planifica y, de
    las áreas donde solo verifica, las que tienen un cierre técnico vigente.
    """
    return (
        base_queryset()
        .filter(
            Q(support_area__in=planning_areas(user))
            | Q(support_area__in=verification_areas(user), status=Incident.Status.CERRADA)
        )
        .annotate(
            has_attachments_flag=Exists(IncidentAttachment.objects.filter(incident=OuterRef("pk"))),
            pending_verification_flag=pending_verification_expression(),
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


# --- Atención, pendientes y verificación (ADR 0006) ------------------------------


def latest_intervention_result_subquery():
    """Resultado de la última intervención registrada sobre la asignación vigente."""
    from .models import IncidentIntervention

    return Subquery(
        IncidentIntervention.objects.filter(incident=OuterRef("pk"), assignment__is_current=True)
        .order_by("-created_at", "-id")
        .values("result")[:1]
    )


def attention_incidents(user) -> QuerySet[Incident]:
    """
    Bandeja del Personal de Atención: incidencias que tiene asignadas ahora mismo y las
    que cerró él, solo en áreas donde sigue siendo técnico autorizado.
    """
    if not has_role(user, Role.PERSONAL_ATENCION):
        return Incident.objects.none()
    assigned_now = IncidentAssignment.objects.filter(is_current=True, technician=user).values(
        "incident_id"
    )
    return (
        base_queryset()
        .filter(support_area__in=technician_areas(user))
        .filter(
            Q(status=Incident.Status.ASIGNADA, pk__in=assigned_now)
            | Q(status=Incident.Status.CERRADA, closing_intervention__technician=user)
        )
        .annotate(last_result=latest_intervention_result_subquery())
        .prefetch_related(current_assignment_prefetch())
    )


def pending_queue(queryset: QuerySet[Incident]) -> QuerySet[Incident]:
    """Abiertas cuya última intervención quedó "En proceso" o "No solucionado"."""
    from .models import IncidentIntervention

    return queryset.filter(status=Incident.Status.ASIGNADA).filter(
        last_result__in=[
            IncidentIntervention.Result.IN_PROGRESS,
            IncidentIntervention.Result.NOT_SOLVED,
        ]
    )


def verification_queue(queryset: QuerySet[Incident]) -> QuerySet[Incident]:
    """Cerradas cuyo cierre técnico vigente todavía no se verificó."""
    return queryset.filter(
        status=Incident.Status.CERRADA, closing_intervention__verification__isnull=True
    )


def can_intervene(user, incident: Incident) -> bool:
    """Solo el técnico asignado ahora, autorizado en el área y con el ticket abierto."""
    if incident.status != Incident.Status.ASIGNADA:
        return False
    current = current_assignment(incident)
    return (
        current is not None
        and current.technician_id == user.pk
        and is_assignable_technician(user, incident.support_area)
    )


def verifiable_by(queryset: QuerySet[Incident], user) -> QuerySet[Incident]:
    """
    Cierres pendientes que el usuario puede verificar: de sus áreas de verificación y
    cuya intervención de cierre no ejecutó él.
    """
    return (
        verification_queue(queryset)
        .filter(support_area__in=verification_areas(user))
        .exclude(closing_intervention__technician=user)
    )


def executed_closing_intervention(user, incident: Incident) -> bool:
    """True si el usuario ejecutó la intervención que cerró técnicamente el ticket."""
    if not incident.closing_intervention_id:
        return False
    return incident.closing_intervention.technician_id == user.pk


def can_verify_closure(user, incident: Incident) -> bool:
    """
    Puede verificar el cierre vigente: función ``can_verify`` en el área, ticket
    cerrado y sin haber ejecutado la intervención de cierre. No mira si ya hay una
    verificación (eso lo controla el servicio).
    """
    return (
        incident.status == Incident.Status.CERRADA
        and incident.closing_intervention_id is not None
        and can_verify_area(user, incident.support_area)
        and not executed_closing_intervention(user, incident)
    )


def closing_verification(incident: Incident):
    """Verificación del cierre vigente, si existe."""
    if not incident.closing_intervention_id:
        return None
    from .models import IncidentVerification

    return IncidentVerification.objects.filter(
        closing_intervention_id=incident.closing_intervention_id
    ).first()
