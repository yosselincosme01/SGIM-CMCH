"""
Resumen del Inicio (ADR 0010): indicadores y pendientes de la persona, calculados solo
con sus capacidades efectivas y sus áreas autorizadas.

Reglas:

- Reutiliza los selectores de permisos (``selectors``). No hay consultas con un alcance
  distinto al de las bandejas existentes: nunca se ve más que en ellas.
- Solo datos reales: conteos, códigos, estados y fechas registradas. No hay SLA ni
  vencimientos.
- **Sin duplicados.** Cada indicador cuenta incidencias distintas. En "Requiere tu
  atención" cada incidencia aparece una sola vez, con la acción que le corresponde a la
  persona: atender, verificar o planificar, en ese orden de prioridad.
"""

from django.db.models import Count, Min, Q, QuerySet

from apps.accounts.roles import is_operational

from . import selectors
from .models import Incident, IncidentAssignment
from .serializers import LimaDateTimeField

TODO_LIMIT = 10

_dt = LimaDateTimeField()


def _iso(value) -> str | None:
    return _dt.to_representation(value) if value else None


def _item(incident: Incident, action: str, date_label: str, date) -> dict:
    return {
        "code": incident.code,
        "status": incident.status,
        "status_label": incident.get_status_display(),
        "area": incident.support_area.code,
        "area_name": incident.support_area.name,
        "care_unit": incident.care_unit.name,
        "action": action,
        "date_label": date_label,
        "date": _iso(date),
    }


def _own_section(user) -> dict:
    own = selectors.own_incidents(user)
    by_status = {
        row["status"]: row["total"] for row in own.values("status").annotate(total=Count("id"))
    }
    return {
        "total": sum(by_status.values()),
        "by_status": [
            {"key": key, "label": label, "total": by_status.get(key, 0)}
            for key, label in Incident.Status.choices
        ],
    }


def _attention_queryset(user) -> QuerySet[Incident]:
    """Asignaciones vigentes abiertas de la persona, de la más próxima a la más lejana."""
    mine = IncidentAssignment.objects.filter(technician=user, is_current=True).values("incident_id")
    return (
        selectors.base_queryset()
        .filter(
            status=Incident.Status.ASIGNADA,
            pk__in=mine,
            support_area__in=selectors.technician_areas(user),
        )
        .annotate(
            current_scheduled_at=Min(
                "assignments__scheduled_at", filter=Q(assignments__is_current=True)
            )
        )
        .order_by("current_scheduled_at", "id")
    )


def _verification_queryset(user) -> QuerySet[Incident]:
    return (
        selectors.verifiable_by(selectors.base_queryset(), user)
        .select_related("closing_intervention")
        .order_by("closing_intervention__created_at", "id")
    )


def _planning_querysets(user) -> tuple[QuerySet[Incident], QuerySet[Incident]]:
    """Por programar (registradas o reabiertas) y con atención pendiente, en sus áreas."""
    planned = selectors.base_queryset().filter(support_area__in=selectors.planning_areas(user))
    to_schedule = planned.filter(
        status__in=[Incident.Status.REGISTRADA, Incident.Status.REABIERTA]
    ).order_by("created_at", "id")
    follow_up = selectors.pending_queue(
        planned.annotate(last_result=selectors.latest_intervention_result_subquery())
    ).order_by("created_at", "id")
    return to_schedule, follow_up


def build_summary(user) -> dict:
    """Resumen del Inicio. Las secciones sin capacidad no se incluyen (valen ``None``)."""
    capabilities = selectors.effective_capabilities(user)
    summary: dict = {
        "own": _own_section(user) if is_operational(user) else None,
        "attention": None,
        "planning": None,
        "verification": None,
        # Encuestas de satisfacción: Etapa 3. No existen todavía.
        "surveys": None,
    }
    # (consulta, acción, etiqueta de la fecha, fecha) en orden de prioridad.
    sources: list[tuple] = []

    if capabilities["can_attend"]:
        attention = _attention_queryset(user)
        summary["attention"] = {"assigned": attention.count()}
        sources.append((attention, "attend", "Programada", lambda i: i.current_scheduled_at))
    if capabilities["can_verify"]:
        verification = _verification_queryset(user)
        summary["verification"] = {"pending": verification.count()}
        sources.append(
            (verification, "verify", "Cerrada", lambda i: i.closing_intervention.created_at)
        )
    if capabilities["can_plan"]:
        to_schedule, follow_up = _planning_querysets(user)
        summary["planning"] = {"to_schedule": to_schedule.count(), "follow_up": follow_up.count()}
        sources.append((to_schedule, "plan", "Registrada", lambda i: i.created_at))
        sources.append((follow_up, "follow_up", "Registrada", lambda i: i.created_at))

    # Una incidencia, una sola vez: gana la primera acción (atender > verificar > planificar).
    distinct: set[str] = set()
    for queryset, *_ in sources:
        distinct.update(queryset.values_list("code", flat=True))
    seen: set[str] = set()
    todo: list[dict] = []
    for queryset, action, date_label, date_of in sources:
        for incident in queryset[: TODO_LIMIT + len(seen)]:
            if len(todo) == TODO_LIMIT:
                break
            if incident.code not in seen:
                seen.add(incident.code)
                todo.append(_item(incident, action, date_label, date_of(incident)))

    summary["todo"] = {"total": len(distinct), "items": todo}
    return summary
