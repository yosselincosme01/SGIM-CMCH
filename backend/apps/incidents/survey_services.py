"""
Encuesta de satisfacción del solicitante (ADR 0012).

Reglas:

- **Voluntaria.** Nunca se envía en nombre del solicitante.
- **Solo el cierre vigente.** Se puede evaluar el cierre técnico vigente de una
  incidencia ``cerrada``. No hace falta esperar la verificación del Responsable de Área.
  Si el ticket se reabre antes de responder, ese cierre deja de ser evaluable; las
  encuestas ya respondidas se conservan.
- **Una por cierre.** Lo garantiza la base de datos (``OneToOne`` con el cierre) y el
  servicio, que bloquea la incidencia para que dos envíos simultáneos no dupliquen.
- **Solo el solicitante original**, con una cuenta operativa activa.
- **Independiente de la verificación.** No cambia el estado del ticket ni registra
  conformidad.
"""

from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction

from apps.accounts.roles import is_operational

from . import selectors
from .models import Incident, IncidentIntervention, SatisfactionSurvey
from .planning_services import PlanningConflict, _lock

COMMENT_MAX = 1000

NOT_REQUESTER = "Solo quien registró la incidencia puede evaluar la atención."
NOT_EVALUABLE = "Esta incidencia no tiene un cierre técnico pendiente de evaluar."
CLOSURE_CHANGED = "El cierre técnico cambió mientras evaluabas. Revisa la incidencia."
ALREADY_ANSWERED = "Este cierre técnico ya fue evaluado."
RATING_REQUIRED = "Selecciona una calificación de 1 a 5 estrellas."

# Recordatorio al iniciar sesión: se muestra una vez por sesión autenticada. La marca vive
# en la sesión de Django (servidor): una recarga no lo repite, un nuevo inicio de sesión
# sí, y nunca pasa de una cuenta a otra.
REMINDER_SESSION_KEY = "sgim_survey_reminder_shown"
REMINDER_ITEMS = 5


def is_requester(user, incident: Incident) -> bool:
    return (
        getattr(user, "is_authenticated", False)
        and incident.created_by_id == user.pk
        and is_operational(user)
    )


def evaluable_closure(incident: Incident) -> IncidentIntervention | None:
    """Cierre técnico vigente, si la incidencia está cerrada y aún no tiene encuesta."""
    if incident.status != Incident.Status.CERRADA or not incident.closing_intervention_id:
        return None
    if SatisfactionSurvey.objects.filter(
        closing_intervention_id=incident.closing_intervention_id
    ).exists():
        return None
    return incident.closing_intervention


def clean_answer(rating, comment) -> tuple[int, str]:
    errors = {}
    valid = (
        isinstance(rating, int)
        and not isinstance(rating, bool)
        and SatisfactionSurvey.RATING_MIN <= rating <= SatisfactionSurvey.RATING_MAX
    )
    if not valid:
        errors["rating"] = RATING_REQUIRED
    comment = (comment or "").strip()
    if len(comment) > COMMENT_MAX:
        errors["comment"] = f"El comentario no puede superar {COMMENT_MAX} caracteres."
    if errors:
        raise ValidationError(errors)
    return rating, comment


@transaction.atomic
def submit_survey(
    *, incident: Incident, actor, closing_intervention_id: int, rating, comment: str = ""
) -> SatisfactionSurvey:
    """
    Registra la evaluación del solicitante sobre el cierre vigente.

    ``closing_intervention_id`` es el cierre que la persona vio al evaluar. Si el
    ticket se reabrió o se volvió a cerrar entretanto, responde 409 en vez de evaluar
    un cierre distinto.
    """
    locked = _lock(incident)
    if not is_requester(actor, locked):
        raise PermissionDenied(NOT_REQUESTER)
    if locked.status != Incident.Status.CERRADA or not locked.closing_intervention_id:
        raise PlanningConflict(NOT_EVALUABLE)
    if locked.closing_intervention_id != closing_intervention_id:
        raise PlanningConflict(CLOSURE_CHANGED)
    if SatisfactionSurvey.objects.filter(
        closing_intervention_id=locked.closing_intervention_id
    ).exists():
        raise PlanningConflict(ALREADY_ANSWERED)

    rating, comment = clean_answer(rating, comment)
    try:
        with transaction.atomic():
            return SatisfactionSurvey.objects.create(
                incident=locked,
                closing_intervention_id=locked.closing_intervention_id,
                respondent=actor,
                rating=rating,
                comment=comment,
            )
    except IntegrityError as exc:
        # Otra petición registró la encuesta entre la comprobación y la escritura.
        raise PlanningConflict(ALREADY_ANSWERED) from exc


def pending_surveys(user):
    """Incidencias propias con un cierre vigente aún sin evaluar, la más reciente primero."""
    if not is_operational(user):
        return Incident.objects.none()
    return (
        selectors.own_incidents(user)
        .filter(
            status=Incident.Status.CERRADA,
            closing_intervention__isnull=False,
            closing_intervention__satisfaction_survey__isnull=True,
        )
        .select_related("closing_intervention")
        .order_by("-closing_intervention__created_at", "-id")
    )
