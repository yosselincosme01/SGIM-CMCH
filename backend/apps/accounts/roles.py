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


# Roles de trabajo de la clínica. Una cuenta activa con al menos uno de ellos es una
# cuenta operativa: puede registrar incidencias y seguir las que registró (ADR 0008).
# El rol Administrador no es operativo: una cuenta solo administrativa no registra
# incidencias. El superusuario tampoco obtiene funciones operativas por serlo.
OPERATIONAL_ROLES: tuple[Role, ...] = (
    Role.SOLICITANTE,
    Role.PLANIFICADOR,
    Role.PERSONAL_ATENCION,
)


def get_roles(user) -> list[str]:
    """Roles del usuario, ordenados. Vacío para usuarios anónimos o inactivos."""
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return []
    names = user.groups.filter(name__in=Role.values).values_list("name", flat=True)
    return sorted(names)


def has_role(user, roles: Role | str | Iterable[Role | str]) -> bool:
    """
    True si el usuario tiene al menos uno de los roles indicados.

    Los roles siempre son explícitos: ser superusuario o administrador **no** concede
    roles funcionales ni acceso global a incidencias. El superusuario solo administra
    el sitio de administración de Django.
    """
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return False
    wanted = {roles} if isinstance(roles, str) else set(roles)
    return user.groups.filter(name__in=wanted).exists()


def is_operational(user) -> bool:
    """True si la cuenta está activa y tiene al menos un rol operativo explícito."""
    return has_role(user, OPERATIONAL_ROLES)
