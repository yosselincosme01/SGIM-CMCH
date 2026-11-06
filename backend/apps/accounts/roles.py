"""
Roles funcionales del SGIM, implementados como Groups de Django.

- Un usuario puede tener varios roles.
- Los grupos se crean **sin permisos**: los permisos específicos sobre incidencias
  se asignarán al desarrollar ese módulo (principio de mínimo privilegio).
- Los roles no vinculan al usuario con una UPS o servicio: la UPS es un dato del ticket.
"""

from collections.abc import Iterable

from django.db import models


class Role(models.TextChoices):
    ADMINISTRADOR = "administrador", "Administrador"
    SOLICITANTE = "solicitante", "Solicitante"
    PLANIFICADOR = "planificador", "Planificador"
    PERSONAL_ATENCION = "personal_atencion", "Personal de atención"


def get_roles(user) -> list[str]:
    """Roles del usuario, ordenados. Vacío para usuarios anónimos o inactivos."""
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return []
    names = user.groups.filter(name__in=Role.values).values_list("name", flat=True)
    return sorted(names)


def has_role(user, roles: Role | str | Iterable[Role | str]) -> bool:
    """
    True si el usuario tiene al menos uno de los roles indicados.

    Los superusuarios (soporte técnico) pasan todas las comprobaciones,
    igual que ocurre con los permisos de Django.
    """
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return False
    if user.is_superuser:
        return True
    wanted = {roles} if isinstance(roles, str) else set(roles)
    return user.groups.filter(name__in=wanted).exists()
