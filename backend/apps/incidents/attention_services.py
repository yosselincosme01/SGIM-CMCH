"""
Atención, cierre técnico, verificación y reapertura (ADR 0006).

Cada operación:
- bloquea la incidencia (y la asignación vigente) con ``select_for_update`` dentro de
  una transacción, para que una intervención, un cierre y una reasignación
  simultáneos no se pisen;
- comprueba en el servidor la autorización y la transición de estado;
- registra el evento en el historial. Nada se edita ni se borra: las
  intervenciones, los cierres y las verificaciones anteriores se conservan.
"""

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from . import selectors
from .attachments import EvidenceImage
from .models import Incident, IncidentEvent, IncidentIntervention, IncidentVerification
from .planning_services import (
    PlanningConflict,
    _check_planner,
    _lock,
    current_assignment_lock_queryset,
)
from .services import delete_stored_files, save_evidence

TEXT_MAX = 2000
REASON_MIN = 10
PHOTOS_MIN = 1
PHOTOS_MAX = 5

NOT_ASSIGNED = "Solo el técnico asignado actualmente puede registrar intervenciones."
NOT_OPEN = "La incidencia no admite intervenciones en su estado actual."
ASSIGNMENT_CHANGED = "La asignación cambió mientras registrabas la intervención."
PHOTO_REQUIRED = "Adjunta al menos una fotografía de evidencia."
TOO_MANY_PHOTOS = f"Puedes adjuntar hasta {PHOTOS_MAX} fotografías."
NOT_CLOSED = "La incidencia no tiene un cierre técnico pendiente de verificar."
ALREADY_VERIFIED = "Este cierre ya fue verificado."
REOPEN_NOT_ALLOWED = "Solo se puede reabrir un cierre verificado como «No conforme»."


def _required_text(value: str, field: str, label: str, errors: dict) -> str:
    value = (value or "").strip()
    if not value:
        errors[field] = f"{label} es obligatorio."
    elif len(value) > TEXT_MAX:
        errors[field] = f"No puede superar {TEXT_MAX} caracteres."
    return value


def _optional_text(value: str, field: str, errors: dict) -> str:
    value = (value or "").strip()
    if len(value) > TEXT_MAX:
        errors[field] = f"No puede superar {TEXT_MAX} caracteres."
    return value


def clean_intervention(
    *,
    diagnosis: str,
    actions_taken: str,
    result: str,
    used_parts: bool,
    used_parts_detail: str = "",
    parts_required: bool,
    parts_required_detail: str = "",
    unresolved_reason: str = "",
    observations: str = "",
    photos: list,
) -> dict:
    """Valida los datos de una intervención. Lanza ``ValidationError`` por campo."""
    errors: dict[str, str] = {}
    data = {
        "diagnosis": _required_text(diagnosis, "diagnosis", "El diagnóstico técnico", errors),
        "actions_taken": _required_text(
            actions_taken, "actions_taken", "Las acciones realizadas", errors
        ),
        "used_parts_detail": _optional_text(used_parts_detail, "used_parts_detail", errors),
        "parts_required_detail": _optional_text(
            parts_required_detail, "parts_required_detail", errors
        ),
        "unresolved_reason": _optional_text(unresolved_reason, "unresolved_reason", errors),
        "observations": _optional_text(observations, "observations", errors),
    }
    if result not in IncidentIntervention.Result.values:
        errors["result"] = "Selecciona el resultado de la intervención."
    if not isinstance(used_parts, bool):
        errors["used_parts"] = "Indica si se utilizaron repuestos."
    if not isinstance(parts_required, bool):
        errors["parts_required"] = "Indica si se requieren repuestos."

    if used_parts is True and not data["used_parts_detail"] and "used_parts_detail" not in errors:
        errors["used_parts_detail"] = "Describe los repuestos utilizados."
    if used_parts is False:
        data["used_parts_detail"] = ""
    if (
        parts_required is True
        and not data["parts_required_detail"]
        and "parts_required_detail" not in errors
    ):
        errors["parts_required_detail"] = "Describe los repuestos requeridos."
    if parts_required is False:
        data["parts_required_detail"] = ""

    if result == IncidentIntervention.Result.SOLVED:
        if data["unresolved_reason"]:
            errors["unresolved_reason"] = "El motivo solo corresponde si no quedó solucionado."
    elif (
        result in IncidentIntervention.Result.values
        and len(data["unresolved_reason"]) < REASON_MIN
        and "unresolved_reason" not in errors
    ):
        errors["unresolved_reason"] = (
            f"Indica el motivo (al menos {REASON_MIN} caracteres) si no quedó solucionado."
        )

    if len(photos) < PHOTOS_MIN:
        errors["photos"] = PHOTO_REQUIRED
    elif len(photos) > PHOTOS_MAX:
        errors["photos"] = TOO_MANY_PHOTOS
    elif not all(isinstance(photo, EvidenceImage) for photo in photos):
        raise TypeError("Las fotografías deben prepararse con prepare_evidence_image.")

    if errors:
        raise ValidationError(errors)
    return {
        **data,
        "result": result,
        "used_parts": used_parts,
        "parts_required": parts_required,
    }


@transaction.atomic
def register_intervention(
    *, incident: Incident, actor, expected_assignment_id: int | None, photos: list, **fields
) -> IncidentIntervention:
    """
    Registra una intervención del técnico asignado actualmente.

    - "Solucionado": cierre técnico automático (``cerrada``), sin aprobación previa.
      La asignación termina y el cierre queda pendiente de verificación.
    - "En proceso" o "No solucionado": el ticket sigue ``asignada`` y aparece en los
      pendientes del Planificador.
    """
    locked = _lock(incident)
    if locked.status != Incident.Status.ASIGNADA:
        raise PlanningConflict(NOT_OPEN)
    current = current_assignment_lock_queryset(locked).first()
    if current is None or current.pk != expected_assignment_id:
        raise PlanningConflict(ASSIGNMENT_CHANGED)
    if current.technician_id != actor.pk:
        raise PermissionDenied(NOT_ASSIGNED)
    if not selectors.is_assignable_technician(actor, locked.support_area):
        raise PermissionDenied(NOT_ASSIGNED)

    data = clean_intervention(photos=photos, **fields)
    stored_files: list = []
    try:
        intervention = IncidentIntervention.objects.create(
            incident=locked, assignment=current, technician=actor, **data
        )
        for photo in photos:
            save_evidence(locked, photo, actor, stored_files, intervention=intervention)
        IncidentEvent.objects.create(
            incident=locked,
            event_type=IncidentEvent.Type.INTERVENTION,
            actor=actor,
            details={
                "intervention": intervention.pk,
                "result": intervention.result,
                "used_parts": intervention.used_parts,
                "parts_required": intervention.parts_required,
                "photos": len(photos),
            },
        )
        if intervention.result == IncidentIntervention.Result.SOLVED:
            now = timezone.now()
            current.is_current = False
            current.ended_at = now
            current.save(update_fields=["is_current", "ended_at"])
            previous = locked.status
            locked.status = Incident.Status.CERRADA
            locked.closing_intervention = intervention
            locked.save(update_fields=["status", "closing_intervention", "updated_at"])
            IncidentEvent.objects.create(
                incident=locked,
                event_type=IncidentEvent.Type.CLOSED,
                actor=actor,
                from_status=previous,
                to_status=locked.status,
                details={"intervention": intervention.pk},
            )
        else:
            locked.save(update_fields=["updated_at"])
    except Exception:
        delete_stored_files(stored_files)
        raise
    return intervention


@transaction.atomic
def verify_closure(*, incident: Incident, actor, result: str, observations: str = ""):
    """El Planificador del área registra Conforme o No conforme sobre el cierre vigente."""
    locked = _lock(incident)
    _check_planner(actor, locked)
    if locked.status != Incident.Status.CERRADA or locked.closing_intervention_id is None:
        raise PlanningConflict(NOT_CLOSED)
    if IncidentVerification.objects.filter(
        closing_intervention_id=locked.closing_intervention_id
    ).exists():
        raise PlanningConflict(ALREADY_VERIFIED)

    observations = (observations or "").strip()
    errors = {}
    if result not in IncidentVerification.Result.values:
        errors["result"] = "Selecciona Conforme o No conforme."
    elif result == IncidentVerification.Result.NOT_CONFORMING and not observations:
        errors["observations"] = "Describe por qué la atención no es conforme."
    if len(observations) > TEXT_MAX:
        errors["observations"] = f"No puede superar {TEXT_MAX} caracteres."
    if errors:
        raise ValidationError(errors)

    verification = IncidentVerification.objects.create(
        incident=locked,
        closing_intervention_id=locked.closing_intervention_id,
        result=result,
        observations=observations,
        verified_by=actor,
    )
    IncidentEvent.objects.create(
        incident=locked,
        event_type=IncidentEvent.Type.VERIFIED,
        actor=actor,
        details={
            "verification": verification.pk,
            "result": result,
            "intervention": locked.closing_intervention_id,
        },
    )
    locked.save(update_fields=["updated_at"])
    return verification


@transaction.atomic
def reopen_incident(*, incident: Incident, actor, reason: str) -> Incident:
    """
    Reabre un cierre verificado como No conforme. Conserva el cierre y la verificación
    anteriores; el ticket mantiene su código y queda listo para una nueva programación.
    """
    locked = _lock(incident)
    _check_planner(actor, locked)
    verification = (
        IncidentVerification.objects.filter(
            closing_intervention_id=locked.closing_intervention_id
        ).first()
        if locked.status == Incident.Status.CERRADA and locked.closing_intervention_id
        else None
    )
    if verification is None or verification.result != IncidentVerification.Result.NOT_CONFORMING:
        raise PlanningConflict(REOPEN_NOT_ALLOWED)

    reason = (reason or "").strip()
    if len(reason) < REASON_MIN:
        raise ValidationError(
            {"reason": f"Indica el motivo de la reapertura (al menos {REASON_MIN} caracteres)."}
        )
    if len(reason) > TEXT_MAX:
        raise ValidationError({"reason": f"No puede superar {TEXT_MAX} caracteres."})

    previous_closure = locked.closing_intervention_id
    locked.status = Incident.Status.REABIERTA
    locked.closing_intervention = None
    locked.save(update_fields=["status", "closing_intervention", "updated_at"])
    IncidentEvent.objects.create(
        incident=locked,
        event_type=IncidentEvent.Type.REOPENED,
        actor=actor,
        from_status=Incident.Status.CERRADA,
        to_status=locked.status,
        details={
            "reason": reason,
            "verification": verification.pk,
            "intervention": previous_closure,
        },
    )
    return locked
