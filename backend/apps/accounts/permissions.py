"""Clases de permiso de DRF basadas en roles."""

from rest_framework.permissions import BasePermission

from .roles import OPERATIONAL_ROLES, Role, has_role


class HasAnyRole(BasePermission):
    """
    Permite el acceso si el usuario tiene al menos uno de ``required_roles``.

    Uso::

        class MiVista(APIView):
            permission_classes = [require_roles(Role.PLANIFICADOR, Role.ADMINISTRADOR)]
    """

    required_roles: tuple[Role, ...] = ()

    def has_permission(self, request, view) -> bool:
        return bool(self.required_roles) and has_role(request.user, self.required_roles)


def require_roles(*roles: Role) -> type[HasAnyRole]:
    if not roles:
        raise ValueError("require_roles necesita al menos un rol.")
    names = "".join(part.title() for role in roles for part in role.name.split("_"))
    return type(f"Requires{names}", (HasAnyRole,), {"required_roles": tuple(roles)})


IsAdministrador = require_roles(Role.ADMINISTRADOR)
IsSolicitante = require_roles(Role.SOLICITANTE)
IsPlanificador = require_roles(Role.PLANIFICADOR)
IsPersonalAtencion = require_roles(Role.PERSONAL_ATENCION)

# Cualquier cuenta operativa activa (registro y seguimiento de sus propias incidencias).
IsOperationalUser = require_roles(*OPERATIONAL_ROLES)
