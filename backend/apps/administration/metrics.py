"""
Alcance, filtros e indicadores de incidencias (ADR 0007).

- **Alcance por rol, en el backend:** el Administrador ve todas las áreas; el
  Planificador, solo las áreas donde tiene el rol y ``can_plan=True``. Ver indicadores
  no concede permiso para planificar, atender ni cerrar.
- **Sin dobles conteos:** las métricas por ticket cuentan incidencias; las de
  intervención cuentan intervenciones; las de ciclo cuentan cierres, verificaciones y
  reaperturas. Cada bloque lo indica en su nombre.
- **Sin SLA:** solo se informan tiempos promedio observados.
"""

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.db.models import Count, Min, QuerySet

from apps.accounts.roles import Role, has_role
from apps.incidents import selectors
from apps.incidents.models import (
    Incident,
    IncidentEvent,
    IncidentIntervention,
    IncidentVerification,
    SupportArea,
)

DEFAULT_DAYS = 30
MAX_RANGE_DAYS = 366

NO_SCOPE = "Tu rol no permite consultar indicadores ni reportes."
AREA_NOT_ALLOWED = "No tienes autorización para esa área."


def lima() -> ZoneInfo:
    return ZoneInfo(settings.SGIM_DISPLAY_TIME_ZONE)


@dataclass(frozen=True)
class Scope:
    """``global`` (Administrador) o ``planner`` (áreas autorizadas del Planificador)."""

    kind: str
    areas: QuerySet[SupportArea]


def scope_for(user) -> Scope:
    if has_role(user, Role.ADMINISTRADOR):
        return Scope("global", SupportArea.objects.all())
    if has_role(user, Role.PLANIFICADOR):
        return Scope("planner", selectors.planning_areas(user))
    raise PermissionDenied(NO_SCOPE)


@dataclass(frozen=True)
class Filters:
    date_from: date
    date_to: date
    area: str
    status: str

    def as_dict(self) -> dict:
        return {
            "date_from": self.date_from.isoformat(),
            "date_to": self.date_to.isoformat(),
            "area": self.area,
            "status": self.status,
        }


def parse_filters(params) -> Filters:
    """Fechas en hora de Lima (por defecto, los últimos 30 días), área y estado."""
    today = datetime.now(lima()).date()
    errors = {}

    def parse(name, default):
        raw = (params.get(name) or "").strip()
        if not raw:
            return default
        try:
            return date.fromisoformat(raw)
        except ValueError:
            errors[name] = "Fecha no válida (AAAA-MM-DD)."
            return default

    date_to = parse("date_to", today)
    date_from = parse("date_from", date_to - timedelta(days=DEFAULT_DAYS - 1))
    if not errors:
        if date_from > date_to:
            errors["date_from"] = "La fecha inicial no puede ser posterior a la final."
        elif (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
            errors["date_from"] = f"El rango no puede superar {MAX_RANGE_DAYS} días."
    status = (params.get("status") or "").strip()
    if status and status not in Incident.Status.values:
        errors["status"] = "Estado no válido."
    if errors:
        raise ValidationError(errors)
    return Filters(date_from, date_to, (params.get("area") or "").strip(), status)


def scoped_incidents(scope: Scope, filters: Filters) -> QuerySet[Incident]:
    """Incidencias registradas en el rango, dentro del alcance del usuario."""
    queryset = Incident.objects.filter(support_area__in=scope.areas)
    if filters.area:
        if not scope.areas.filter(code=filters.area).exists():
            raise PermissionDenied(AREA_NOT_ALLOWED)
        queryset = queryset.filter(support_area__code=filters.area)
    start = datetime.combine(filters.date_from, time.min, tzinfo=lima())
    end = datetime.combine(filters.date_to + timedelta(days=1), time.min, tzinfo=lima())
    queryset = queryset.filter(created_at__gte=start, created_at__lt=end)
    if filters.status:
        queryset = queryset.filter(status=filters.status)
    return queryset


def _hours(start, end) -> float:
    return (end - start).total_seconds() / 3600


def _average(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _breakdown(queryset, field, label_field=None, empty="Sin dato") -> list[dict]:
    label_field = label_field or field
    rows = queryset.values(field, label_field).annotate(total=Count("id")).order_by("-total", field)
    return [
        {"key": row[field] or "", "label": row[label_field] or empty, "total": row["total"]}
        for row in rows
    ]


def compute_dashboard(incidents: QuerySet[Incident]) -> dict:
    tickets = incidents.annotate(last_result=selectors.latest_intervention_result_subquery())
    status_counts = dict(incidents.values_list("status").annotate(total=Count("id")))
    pending_attention = selectors.pending_queue(tickets).count()
    interventions = IncidentIntervention.objects.filter(incident__in=incidents)
    verifications = IncidentVerification.objects.filter(incident__in=incidents)
    reopen_events = IncidentEvent.objects.filter(
        incident__in=incidents, event_type=IncidentEvent.Type.REOPENED
    )

    first_times = incidents.annotate(first=Min("interventions__created_at")).values_list(
        "created_at", "first"
    )
    to_first = [_hours(created, first) for created, first in first_times if first]
    closure_times = incidents.filter(status=Incident.Status.CERRADA).values_list(
        "created_at", "closing_intervention__created_at"
    )
    to_closure = [_hours(created, closed) for created, closed in closure_times if closed]

    status_labels = dict(Incident.Status.choices)
    open_statuses = (
        Incident.Status.REGISTRADA,
        Incident.Status.ASIGNADA,
        Incident.Status.REABIERTA,
    )
    return {
        # Por ticket: cada incidencia cuenta una vez.
        "tickets": {
            "total": sum(status_counts.values()),
            "open": sum(status_counts.get(s, 0) for s in open_statuses),
            "pending_management": status_counts.get(Incident.Status.REGISTRADA, 0)
            + status_counts.get(Incident.Status.REABIERTA, 0),
            "in_progress": pending_attention,
            "closed": status_counts.get(Incident.Status.CERRADA, 0),
            "pending_verification": selectors.verification_queue(incidents).count(),
            "reopened": reopen_events.values("incident").distinct().count(),
        },
        # Por ciclo de atención: cierres verificados y reaperturas.
        "cycles": {
            "conforming": verifications.filter(
                result=IncidentVerification.Result.CONFORMING
            ).count(),
            "not_conforming": verifications.filter(
                result=IncidentVerification.Result.NOT_CONFORMING
            ).count(),
            "reopenings": reopen_events.count(),
        },
        # Por intervención.
        "interventions": {
            "total": interventions.count(),
            "by_result": [
                {
                    "key": row["result"],
                    "label": IncidentIntervention.Result(row["result"]).label,
                    "total": row["total"],
                }
                for row in interventions.values("result")
                .annotate(total=Count("id"))
                .order_by("result")
            ],
        },
        "times": {
            "avg_hours_to_first_intervention": _average(to_first),
            "tickets_with_intervention": len(to_first),
            "avg_hours_to_closure": _average(to_closure),
            "closed_tickets_measured": len(to_closure),
        },
        "by_status": [
            {"key": key, "label": status_labels.get(key, key), "total": total}
            for key, total in sorted(status_counts.items(), key=lambda item: -item[1])
        ],
        "by_area": _breakdown(incidents, "support_area__code", "support_area__name"),
        "by_care_unit": _breakdown(incidents, "care_unit__code", "care_unit__name"),
        "by_priority": _breakdown(incidents, "priority__code", "priority__name", "Sin prioridad"),
    }
