"""
Casos de uso de planificación y asignación (ADR 0004).

Toda escritura de planificación pasa por aquí. Cada función:
- bloquea la incidencia (``select_for_update``) dentro de una transacción;
- comprueba en el servidor que el usuario sea Planificador del área de la incidencia;
- registra en el historial quién hizo el cambio, cuándo y qué valores cambiaron.

Las reglas de prioridad, plazos y reasignación son **provisionales**: no hay SLA ni
reglas automáticas. Solo se implementa la transición ``registrada`` → ``asignada``.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from . import selectors
from .models import Incident, IncidentAssignment, IncidentEvent, PriorityLevel

REASON_MIN = 10
REASON_MAX = 500
NOTES_MAX = 1000

NOT_PLANNER = "No eres Planificador del área de esta incidencia."
NOT_PLANNABLE = "La incidencia no se puede planificar en su estado actual."
INVALID_TECHNICIAN = "La persona seleccionada no es técnico autorizado de esta área."
INVALID_PRIORITY = "Selecciona una prioridad válida."
PAST_SCHEDULE = "La fecha y hora de atención no puede estar en el pasado."
REASON_REQUIRED = f"Indica el motivo del cambio (al menos {REASON_MIN} caracteres)."


class PlanningConflict(Exception):
    """La incidencia cambió mientras el usuario la planificaba (respuesta 409)."""


# --- Utilidades internas ------------------------------------------------------


def incident_lock_queryset():
    """
    Bloquea **solo la fila de la incidencia** (``FOR UPDATE OF incidents_incident``).

    ``priority`` es opcional, así que ``select_related`` la une con un LEFT OUTER
    JOIN. Un ``FOR UPDATE`` sin ``of`` intenta bloquear también el lado nulable de
    esa unión, y PostgreSQL lo rechaza ("FOR UPDATE cannot be applied to the
    nullable side of an outer join"). Además, no hace falta bloquear el área ni el
    nivel de prioridad: son catálogos compartidos por otras incidencias.
    """
    return Incident.objects.select_for_update(of=("self",)).select_related(
        "support_area", "priority"
    )


def current_assignment_lock_queryset(incident: Incident):
    """
    Bloquea solo la fila de la asignación vigente. El técnico se carga para el
    historial, pero su fila de usuario no se bloquea (no debe impedir, por ejemplo,
    que inicie sesión mientras se reprograma).
    """
    return (
        IncidentAssignment.objects.select_for_update(of=("self",))
        .select_related("technician")
        .filter(incident=incident, is_current=True)
    )


def _lock(incident: Incident) -> Incident:
    return incident_lock_queryset().get(pk=incident.pk)


def _check_planner(user, incident: Incident) -> None:
    if not selectors.can_plan_area(user, incident.support_area):
        raise PermissionDenied(NOT_PLANNER)


def _check_plannable(incident: Incident) -> None:
    if incident.status not in selectors.PLANNABLE_STATUSES:
        raise PlanningConflict(NOT_PLANNABLE)


def _check_priority(priority: PriorityLevel | None) -> None:
    if priority is None or not priority.is_active:
        raise ValidationError({"priority": INVALID_PRIORITY})


def _clean_reason(reason: str, *, required: bool) -> str:
    reason = (reason or "").strip()
    if len(reason) > REASON_MAX:
        raise ValidationError({"reason": f"El motivo no puede superar {REASON_MAX} caracteres."})
    if required and len(reason) < REASON_MIN:
        raise ValidationError({"reason": REASON_REQUIRED})
    return reason


def _check_not_past(scheduled_at: datetime) -> None:
    # Se acepta el minuto en curso: el formulario trabaja con minutos.
    now = timezone.now().replace(second=0, microsecond=0)
    if scheduled_at < now:
        raise ValidationError({"scheduled_at": PAST_SCHEDULE})


def _iso(value: datetime) -> str:
    """Fecha en la zona de presentación (America/Lima), con su desfase explícito."""
    return timezone.localtime(value, ZoneInfo(settings.SGIM_DISPLAY_TIME_ZONE)).isoformat()


def _person(user) -> dict:
    return {"username": user.username, "full_name": user.full_name}


def _priority(level: PriorityLevel | None) -> dict | None:
    return {"code": level.code, "name": level.name} if level else None


def _event(incident, actor, event_type, *, details, from_status="", to_status=""):
    return IncidentEvent.objects.create(
        incident=incident,
        event_type=event_type,
        actor=actor,
        from_status=from_status,
        to_status=to_status,
        details=details,
    )


def _apply_priority(incident, actor, priority, reason="") -> bool:
    """Cambia la prioridad y registra el evento. Devuelve False si no cambió."""
    if incident.priority_id == priority.pk:
        return False
    previous = incident.priority
    incident.priority = priority
    incident.save(update_fields=["priority", "updated_at"])
    details = {"from": _priority(previous), "to": _priority(priority)}
    if reason:
        details["reason"] = reason
    _event(incident, actor, IncidentEvent.Type.PRIORITY_CHANGED, details=details)
    return True


# --- Casos de uso -------------------------------------------------------------


@transaction.atomic
def set_priority(*, incident: Incident, actor, priority: PriorityLevel | None, reason: str = ""):
    """
    Establece o cambia la prioridad, antes o después de programar la atención.
    El motivo es opcional (las reglas de cambio de prioridad están pendientes).
    """
    locked = _lock(incident)
    _check_planner(actor, locked)
    _check_plannable(locked)
    _check_priority(priority)
    reason = _clean_reason(reason, required=False)
    if not _apply_priority(locked, actor, priority, reason):
        raise ValidationError({"priority": "La incidencia ya tiene esa prioridad."})
    return locked


@transaction.atomic
def schedule_attention(
    *,
    incident: Incident,
    actor,
    priority: PriorityLevel | None,
    technician,
    scheduled_at: datetime,
    notes: str = "",
    reason: str = "",
    expected_assignment_id: int | None = None,
) -> Incident:
    """
    Programa la atención (primera vez) o la reprograma o reasigna.

    - ``expected_assignment_id`` es la asignación vigente que el usuario estaba
      viendo (``None`` si no había). Si no coincide, otro Planificador la cambió:
      se lanza ``PlanningConflict`` y no se modifica nada.
    - El técnico debe ser técnico autorizado del área. Un Planificador solo puede
      asignarse a sí mismo si también es técnico autorizado de esa misma área.
    - Reprogramar o reasignar exige un motivo y registra los valores anteriores y
      nuevos en el historial.
    """
    locked = _lock(incident)
    _check_planner(actor, locked)
    _check_plannable(locked)

    current = current_assignment_lock_queryset(locked).first()
    if (current.pk if current else None) != expected_assignment_id:
        raise PlanningConflict("Otro Planificador actualizó esta incidencia.")

    _check_priority(priority)
    if not selectors.is_assignable_technician(technician, locked.support_area):
        raise ValidationError({"technician": INVALID_TECHNICIAN})
    notes = (notes or "").strip()
    if len(notes) > NOTES_MAX:
        raise ValidationError(
            {"notes": f"Las indicaciones no pueden superar {NOTES_MAX} caracteres."}
        )

    now = timezone.now()
    if current is None:
        _check_not_past(scheduled_at)
        reason = _clean_reason(reason, required=False)
        _apply_priority(locked, actor, priority, reason)
        IncidentAssignment.objects.create(
            incident=locked,
            technician=technician,
            assigned_by=actor,
            scheduled_at=scheduled_at,
            notes=notes,
        )
        previous_status = locked.status
        locked.status = Incident.Status.ASIGNADA
        locked.save(update_fields=["status", "updated_at"])
        _event(
            locked,
            actor,
            IncidentEvent.Type.ASSIGNED,
            from_status=previous_status,
            to_status=locked.status,
            details={
                "technician": _person(technician),
                "scheduled_at": _iso(scheduled_at),
                "priority": _priority(priority),
            },
        )
        return locked

    technician_changed = current.technician_id != technician.pk
    schedule_changed = current.scheduled_at != scheduled_at
    if not (technician_changed or schedule_changed):
        raise ValidationError(
            {"non_field_errors": "Cambia el técnico responsable o la fecha para reprogramar."}
        )
    reason = _clean_reason(reason, required=True)
    if schedule_changed:
        _check_not_past(scheduled_at)

    _apply_priority(locked, actor, priority, reason)
    current.is_current = False
    current.ended_at = now
    current.save(update_fields=["is_current", "ended_at"])
    IncidentAssignment.objects.create(
        incident=locked,
        technician=technician,
        assigned_by=actor,
        scheduled_at=scheduled_at,
        notes=notes,
        reason=reason,
    )
    if technician_changed:
        _event(
            locked,
            actor,
            IncidentEvent.Type.TECHNICIAN_CHANGED,
            details={
                "from": _person(current.technician),
                "to": _person(technician),
                "reason": reason,
            },
        )
    if schedule_changed:
        _event(
            locked,
            actor,
            IncidentEvent.Type.SCHEDULE_CHANGED,
            details={
                "from": _iso(current.scheduled_at),
                "to": _iso(scheduled_at),
                "reason": reason,
            },
        )
    locked.save(update_fields=["updated_at"])
    return locked
