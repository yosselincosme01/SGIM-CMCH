"""
Consultas de incidencias según los permisos del usuario.

Reglas de esta etapa (pendientes de validar; ver docs/adr/0003-incidencias.md):
- Cualquier usuario consulta las incidencias que él mismo registró.
- Los integrantes de un área de soporte con rol planificador o personal_atencion
  consultan además las incidencias dirigidas a su área.
- No hay acceso entre áreas ni acceso global del rol administrador.
"""

from django.db.models import Q, QuerySet

from apps.accounts.roles import Role, has_role

from .models import Incident

AREA_ROLES = (Role.PLANIFICADOR, Role.PERSONAL_ATENCION)


def base_queryset() -> QuerySet[Incident]:
    return Incident.objects.select_related("care_unit", "support_area", "created_by")


def can_view_area_inbox(user) -> bool:
    return has_role(user, AREA_ROLES)


def own_incidents(user) -> QuerySet[Incident]:
    return base_queryset().filter(created_by=user)


def area_incidents(user) -> QuerySet[Incident]:
    """Incidencias de las áreas de soporte a las que pertenece el usuario."""
    if not can_view_area_inbox(user):
        return Incident.objects.none()
    return base_queryset().filter(
        support_area__memberships__user=user, support_area__is_active=True
    )


def visible_incidents(user) -> QuerySet[Incident]:
    """Todo lo que el usuario puede ver en detalle: las propias y las de sus áreas."""
    condition = Q(created_by=user)
    if can_view_area_inbox(user):
        condition |= Q(support_area__memberships__user=user, support_area__is_active=True)
    return base_queryset().filter(condition).distinct()
