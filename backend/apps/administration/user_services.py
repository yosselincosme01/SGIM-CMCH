"""
Gestión de cuentas operativas por el Administrador del SGIM (ADR 0007).

Principios:
- **Mínimo privilegio:** el Administrador solo gestiona los roles operativos
  (Solicitante, Planificador, Personal de atención) y las funciones por área:
  planificar (``can_plan``), registrar atenciones (``can_be_assigned``) y verificar
  conformidad (``can_verify``). Las tres son independientes; verificar no exige el rol
  Planificador (ADR 0008).
- **Sin escalamiento:** no puede otorgar el rol Administrador, ni modificar cuentas
  administrativas, de superusuario o de staff, ni su propia cuenta. Las cuentas
  administrativas se crean solo con el procedimiento técnico de TI
  (``manage.py create_sgim_admin``).
- **Sin sistema paralelo:** se usan los Groups y ``SupportAreaMembership`` existentes.
- Cada cambio se hace en una transacción, con bloqueo de la fila de la cuenta, y queda
  en la auditoría sin contraseñas.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.db.models.functions import Lower

from apps.accounts.roles import OPERATIONAL_ROLES, Role, get_roles, has_role
from apps.incidents.models import Incident, IncidentAssignment, SupportArea, SupportAreaMembership

from .models import AuditLog

MANAGED_ROLES = (Role.SOLICITANTE, Role.PLANIFICADOR, Role.PERSONAL_ATENCION)

NOT_ADMIN = "Solo el Administrador del SGIM puede gestionar cuentas."
PROTECTED = "Las cuentas administrativas solo se gestionan mediante el procedimiento técnico de TI."
SELF_CHANGE = "No puedes modificar tu propia cuenta desde la administración."
ADMIN_ROLE = "El rol Administrador no se puede otorgar desde la aplicación."
OPEN_ASSIGNMENTS = (
    "La persona tiene asignaciones vigentes. Pide al Responsable de Área que las reasigne antes de "
    "retirarle la función o desactivar la cuenta."
)


class AdminConflict(Exception):
    """El cambio dejaría trabajo sin seguimiento o choca con el estado actual (409)."""


def is_protected_account(user) -> bool:
    """Cuentas que la administración operativa no puede modificar."""
    return bool(
        user.is_superuser or user.is_staff or user.groups.filter(name=Role.ADMINISTRADOR).exists()
    )


def _check_actor(actor) -> None:
    if not has_role(actor, Role.ADMINISTRADOR):
        raise PermissionDenied(NOT_ADMIN)


def _check_target(actor, user) -> None:
    if user.pk == actor.pk:
        raise PermissionDenied(SELF_CHANGE)
    if is_protected_account(user):
        raise PermissionDenied(PROTECTED)


def _lock_user(user):
    return get_user_model().objects.select_for_update().get(pk=user.pk)


def _audit(actor, action, target=None, **details):
    return AuditLog.objects.create(actor=actor, action=action, target_user=target, details=details)


def open_assignment_areas(user) -> set[str]:
    """Áreas donde la persona tiene asignaciones vigentes sobre tickets abiertos."""
    return set(
        IncidentAssignment.objects.filter(
            technician=user, is_current=True, incident__status=Incident.Status.ASIGNADA
        ).values_list("incident__support_area__code", flat=True)
    )


# --- Validación de datos ----------------------------------------------------------


def clean_roles(roles) -> list[str]:
    roles = sorted(set(roles or []))
    if Role.ADMINISTRADOR in roles:
        raise ValidationError({"roles": ADMIN_ROLE})
    unknown = [role for role in roles if role not in MANAGED_ROLES]
    if unknown:
        raise ValidationError({"roles": "Rol no válido."})
    return roles


def clean_memberships(memberships, roles: list[str]) -> dict[str, dict]:
    """
    ``[{"area": "ti", "can_plan": bool, "can_be_assigned": bool, "can_verify": bool}, …]``
    → por código. Planificar exige el rol Planificador y registrar atenciones, el rol
    Personal de atención. Verificar conformidad solo exige una cuenta operativa (algún
    rol operativo), no el rol Planificador. Las funciones son independientes: ninguna se
    concede ni se retira por otra. Sin funciones, no hay pertenencia.
    """
    areas = {area.code: area for area in SupportArea.objects.filter(is_active=True)}
    result: dict[str, dict] = {}
    for item in memberships or []:
        code = item.get("area")
        if code not in areas:
            raise ValidationError({"memberships": "Área de soporte no válida."})
        if code in result:
            raise ValidationError({"memberships": "Un área aparece más de una vez."})
        can_plan = item.get("can_plan") is True
        can_be_assigned = item.get("can_be_assigned") is True
        can_verify = item.get("can_verify") is True
        if can_plan and Role.PLANIFICADOR not in roles:
            raise ValidationError(
                {
                    "memberships": (
                        "Para planificar en un área, asigna también el rol Responsable de Área."
                    )
                }
            )
        if can_be_assigned and Role.PERSONAL_ATENCION not in roles:
            raise ValidationError(
                {
                    "memberships": (
                        "Para recibir asignaciones, asigna también el rol Personal de atención."
                    )
                }
            )
        if can_verify and not set(roles) & set(OPERATIONAL_ROLES):
            raise ValidationError(
                {"memberships": "Para verificar conformidad, asigna al menos un rol operativo."}
            )
        if can_plan or can_be_assigned or can_verify:
            result[code] = {
                "area": areas[code],
                "can_plan": can_plan,
                "can_be_assigned": can_be_assigned,
                "can_verify": can_verify,
            }
    return result


def _current_memberships(user) -> dict[str, dict]:
    return {
        m.area.code: {
            "can_plan": m.can_plan,
            "can_be_assigned": m.can_be_assigned,
            "can_verify": m.can_verify,
        }
        for m in SupportAreaMembership.objects.filter(user=user).select_related("area")
    }


def _apply_roles(user, roles: list[str]) -> None:
    managed = Group.objects.filter(name__in=MANAGED_ROLES)
    user.groups.remove(*[g for g in managed if g.name not in roles])
    user.groups.add(*[g for g in managed if g.name in roles])


def _apply_memberships(user, wanted: dict[str, dict]) -> None:
    SupportAreaMembership.objects.filter(user=user).exclude(area__code__in=wanted).delete()
    for data in wanted.values():
        SupportAreaMembership.objects.update_or_create(
            user=user,
            area=data["area"],
            defaults={
                "can_plan": data["can_plan"],
                "can_be_assigned": data["can_be_assigned"],
                "can_verify": data["can_verify"],
            },
        )


def _check_assignments_kept(user, roles: list[str], memberships: dict[str, dict]) -> None:
    """No se puede retirar la función técnica donde hay trabajo asignado sin terminar."""
    busy = open_assignment_areas(user)
    if not busy:
        return
    if Role.PERSONAL_ATENCION not in roles:
        raise AdminConflict(OPEN_ASSIGNMENTS)
    for code in busy:
        if not memberships.get(code, {}).get("can_be_assigned"):
            raise AdminConflict(OPEN_ASSIGNMENTS)


def _clean_profile(first_name, last_name, email) -> dict:
    errors = {}
    data = {
        "first_name": (first_name or "").strip(),
        "last_name": (last_name or "").strip(),
        "email": (email or "").strip().lower(),
    }
    if not data["first_name"]:
        errors["first_name"] = "Indica el nombre."
    if not data["last_name"]:
        errors["last_name"] = "Indica el apellido."
    if errors:
        raise ValidationError(errors)
    return data


# --- Casos de uso ---------------------------------------------------------------------


@transaction.atomic
def create_operational_user(
    *, actor, username, first_name, last_name, email, password, roles, memberships
):
    """Crea una cuenta operativa con contraseña validada por las reglas de Django."""
    _check_actor(actor)
    username = (username or "").strip()
    profile = _clean_profile(first_name, last_name, email)
    roles = clean_roles(roles)
    wanted = clean_memberships(memberships, roles)
    user_model = get_user_model()
    if not username:
        raise ValidationError({"username": "Indica el nombre de usuario."})
    if user_model.objects.annotate(lower=Lower("username")).filter(lower=username.lower()).exists():
        raise ValidationError({"username": "Ese nombre de usuario ya existe."})

    user = user_model(username=username, **profile, is_active=True)
    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        raise ValidationError({"password": exc.messages}) from exc
    user.set_password(password)
    user.full_clean(exclude=["password"])
    user.save()
    _apply_roles(user, roles)
    _apply_memberships(user, wanted)
    _audit(
        actor,
        AuditLog.Action.USER_CREATED,
        user,
        username=user.username,
        roles=roles,
        memberships=_current_memberships(user),
    )
    return user


@transaction.atomic
def update_operational_user(
    *, actor, user, first_name=None, last_name=None, email=None, roles=None, memberships=None
):
    """Actualiza datos, roles y autorizaciones por área en una sola transacción."""
    _check_actor(actor)
    user = _lock_user(user)
    _check_target(actor, user)

    if first_name is not None or last_name is not None or email is not None:
        profile = _clean_profile(
            user.first_name if first_name is None else first_name,
            user.last_name if last_name is None else last_name,
            user.email if email is None else email,
        )
        before = {key: getattr(user, key) for key in profile}
        changes = {k: {"from": before[k], "to": v} for k, v in profile.items() if before[k] != v}
        if changes:
            for key, value in profile.items():
                setattr(user, key, value)
            user.full_clean(exclude=["password"])
            user.save(update_fields=list(profile))
            _audit(actor, AuditLog.Action.USER_UPDATED, user, changes=changes)

    current_roles = [r for r in get_roles(user) if r in MANAGED_ROLES]
    new_roles = clean_roles(current_roles if roles is None else roles)
    operational = bool(set(new_roles) & set(OPERATIONAL_ROLES))
    if memberships is None:
        # Si se retira un rol, sus funciones por área dejan de tener efecto: se retiran.
        memberships = [
            {
                "area": code,
                "can_plan": data["can_plan"] and Role.PLANIFICADOR in new_roles,
                "can_be_assigned": data["can_be_assigned"] and Role.PERSONAL_ATENCION in new_roles,
                "can_verify": data["can_verify"] and operational,
            }
            for code, data in _current_memberships(user).items()
        ]
    wanted = clean_memberships(memberships, new_roles)
    _check_assignments_kept(user, new_roles, wanted)

    before_memberships = _current_memberships(user)
    if new_roles != sorted(current_roles):
        _apply_roles(user, new_roles)
        _audit(
            actor,
            AuditLog.Action.ROLES_CHANGED,
            user,
            changes={"from": sorted(current_roles), "to": new_roles},
        )
    _apply_memberships(user, wanted)
    after_memberships = _current_memberships(user)
    if after_memberships != before_memberships:
        _audit(
            actor,
            AuditLog.Action.MEMBERSHIPS_CHANGED,
            user,
            changes={"from": before_memberships, "to": after_memberships},
        )
    return user


@transaction.atomic
def set_user_active(*, actor, user, active: bool):
    """Activa o desactiva. La desactivación conserva el historial e impide nuevos accesos."""
    _check_actor(actor)
    user = _lock_user(user)
    _check_target(actor, user)
    if user.is_active == active:
        raise AdminConflict("La cuenta ya está " + ("activa." if active else "desactivada."))
    if not active and open_assignment_areas(user):
        raise AdminConflict(OPEN_ASSIGNMENTS)
    user.is_active = active
    user.save(update_fields=["is_active"])
    # Al desactivar, Django deja de aceptar sus sesiones (ModelBackend.get_user).
    _audit(
        actor,
        AuditLog.Action.USER_ACTIVATED if active else AuditLog.Action.USER_DEACTIVATED,
        user,
    )
    return user


@transaction.atomic
def reset_user_password(*, actor, user, new_password: str):
    """
    Restablece el acceso con una contraseña nueva que define el Administrador. Las
    sesiones abiertas de esa cuenta dejan de ser válidas. Nunca se guarda ni se audita
    la contraseña.
    """
    _check_actor(actor)
    user = _lock_user(user)
    _check_target(actor, user)
    try:
        validate_password(new_password, user=user)
    except ValidationError as exc:
        raise ValidationError({"password": exc.messages}) from exc
    user.set_password(new_password)
    user.save(update_fields=["password"])
    _audit(actor, AuditLog.Action.PASSWORD_RESET, user)
    return user


def record_export(*, actor, report: str, scope: str, filters: dict, rows: int):
    """Auditoría de una descarga de reporte (sin el contenido exportado)."""
    return _audit(
        actor,
        AuditLog.Action.REPORT_EXPORTED,
        None,
        report=report,
        scope=scope,
        filters=filters,
        rows=rows,
    )
