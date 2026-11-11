"""
Reportes Excel (.xlsx) con openpyxl (ADR 0007).

Seguridad:
- **Inyección de fórmulas:** todo texto que empiece por ``=``, ``+``, ``-``, ``@``,
  tabulación o retorno se exporta con un apóstrofo inicial y como texto, para que Excel
  no lo ejecute (recomendación OWASP "CSV/Formula Injection").
- Se eliminan caracteres de control no válidos en XML.
- Solo se exportan datos operativos de incidencias: nunca contraseñas, correos,
  sesiones ni rutas de archivos.
- Límite de filas por descarga (``MAX_ROWS``) y de rango de fechas (``metrics``).
"""

import io
from collections.abc import Callable, Iterable
from datetime import datetime

from django.db.models import Count, Min, Q
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from apps.incidents import selectors
from apps.incidents.models import (
    IncidentEvent,
    IncidentIntervention,
    IncidentVerification,
    SatisfactionSurvey,
)

from .metrics import Filters, lima

MAX_ROWS = 5000
TOO_MANY_ROWS = "El reporte supera {max} filas ({rows}). Acota el rango de fechas o el área."
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")


class ReportTooLarge(Exception):
    pass


def safe_cell(value):
    """Valor seguro para una celda: textos sin fórmulas ni caracteres inválidos."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        # openpyxl no admite fechas con zona horaria: se exportan en hora de Lima.
        return value.astimezone(lima()).replace(tzinfo=None)
    if isinstance(value, bool):
        return "Sí" if value else "No"
    if isinstance(value, int | float):
        return value
    text = ILLEGAL_CHARACTERS_RE.sub("", str(value))
    if text.startswith(FORMULA_PREFIXES):
        text = "'" + text
    return text


def _name(user) -> str:
    return user.full_name if user else ""


def _hours(start, end):
    return round((end - start).total_seconds() / 3600, 1) if start and end else ""


# --- Definición de los cinco reportes ----------------------------------------------


def _incidents_rows(incidents):
    yield [
        "Código",
        "Registrada",
        "Actualizada",
        "UPS / servicio",
        "Área de soporte",
        "Prioridad",
        "Estado",
        "Identificación del equipo",
        "Solicitante",
    ]
    for item in incidents.select_related("care_unit", "support_area", "priority", "created_by"):
        yield [
            item.code,
            item.created_at,
            item.updated_at,
            item.care_unit.name,
            item.support_area.name,
            item.priority.name if item.priority else "Sin prioridad",
            item.get_status_display(),
            item.get_equipment_qr_status_display(),
            _name(item.created_by),
        ]


def _times_rows(incidents):
    yield [
        "Código",
        "Área de soporte",
        "Estado",
        "Registrada",
        "Primera intervención",
        "Horas hasta la primera intervención",
        "Cierre técnico vigente",
        "Horas hasta el cierre técnico",
        "Intervenciones",
        "Reaperturas",
    ]
    rows = incidents.select_related("support_area", "closing_intervention").annotate(
        first=Min("interventions__created_at"),
        interventions_total=Count("interventions", distinct=True),
        reopenings=Count(
            "events", filter=Q(events__event_type=IncidentEvent.Type.REOPENED), distinct=True
        ),
    )
    for item in rows:
        closed_at = item.closing_intervention.created_at if item.closing_intervention else None
        yield [
            item.code,
            item.support_area.name,
            item.get_status_display(),
            item.created_at,
            item.first,
            _hours(item.created_at, item.first),
            closed_at,
            _hours(item.created_at, closed_at),
            item.interventions_total,
            item.reopenings,
        ]


def _interventions_rows(incidents):
    yield [
        "Código",
        "Área de soporte",
        "Fecha",
        "Responsable",
        "Resultado",
        "Diagnóstico técnico",
        "Acciones realizadas",
        "Repuestos utilizados",
        "Repuestos requeridos",
        "Motivo",
        "Observaciones",
    ]
    queryset = (
        IncidentIntervention.objects.filter(incident__in=incidents)
        .select_related("incident__support_area", "technician")
        .order_by("incident__code", "created_at")
    )
    for item in queryset:
        yield [
            item.incident.code,
            item.incident.support_area.name,
            item.created_at,
            _name(item.technician),
            item.get_result_display(),
            item.diagnosis,
            item.actions_taken,
            item.used_parts_detail if item.used_parts else "No",
            item.parts_required_detail if item.parts_required else "No",
            item.unresolved_reason,
            item.observations,
        ]


def _pending_rows(incidents):
    yield [
        "Código",
        "Área de soporte",
        "Prioridad",
        "Técnico asignado",
        "Fecha programada",
        "Último resultado",
        "Motivo",
        "Observaciones",
        "Última intervención",
    ]
    pending = selectors.pending_queue(
        incidents.annotate(last_result=selectors.latest_intervention_result_subquery())
    ).select_related("support_area", "priority")
    for item in pending.prefetch_related(selectors.current_assignment_prefetch()):
        assignment = selectors.current_assignment(item)
        last = (
            item.interventions.filter(assignment=assignment)
            .select_related("technician")
            .order_by("-created_at", "-id")
            .first()
            if assignment
            else None
        )
        yield [
            item.code,
            item.support_area.name,
            item.priority.name if item.priority else "Sin prioridad",
            _name(assignment.technician) if assignment else "",
            assignment.scheduled_at if assignment else None,
            last.get_result_display() if last else "",
            last.unresolved_reason if last else "",
            last.observations if last else "",
            last.created_at if last else None,
        ]


def _verifications_rows(incidents):
    yield [
        "Código",
        "Área de soporte",
        "Cierre técnico",
        "Cerrada por",
        "Verificación",
        "Verificada por",
        "Fecha de verificación",
        "Observaciones",
        "Reabierta",
        "Motivo de reapertura",
        "Fecha de reapertura",
    ]
    reopenings = {
        event.details.get("intervention"): event
        for event in IncidentEvent.objects.filter(
            incident__in=incidents, event_type=IncidentEvent.Type.REOPENED
        )
    }
    queryset = (
        IncidentVerification.objects.filter(incident__in=incidents)
        .select_related("incident__support_area", "closing_intervention__technician", "verified_by")
        .order_by("incident__code", "created_at")
    )
    for item in queryset:
        reopen = reopenings.get(item.closing_intervention_id)
        yield [
            item.incident.code,
            item.incident.support_area.name,
            item.closing_intervention.created_at,
            _name(item.closing_intervention.technician),
            item.get_result_display(),
            _name(item.verified_by),
            item.created_at,
            item.observations,
            bool(reopen),
            reopen.details.get("reason", "") if reopen else "",
            reopen.created_at if reopen else None,
        ]


def _satisfaction_rows(incidents):
    """
    Una fila por cierre técnico (ADR 0012): la evaluación del solicitante o su estado.
    "Pendiente" es un cierre vigente aún evaluable; "No evaluada (reabierta)", un cierre
    que dejó de ser evaluable al reabrirse el ticket sin respuesta.
    """
    yield [
        "Código",
        "Área de soporte",
        "UPS / servicio",
        "Cierre técnico",
        "Cerrada por",
        "Encuesta",
        "Calificación (1-5)",
        "Comentario",
        "Fecha de respuesta",
    ]
    surveys = {
        survey.closing_intervention_id: survey
        for survey in SatisfactionSurvey.objects.filter(incident__in=incidents)
    }
    closures = (
        IncidentIntervention.objects.filter(
            incident__in=incidents, result=IncidentIntervention.Result.SOLVED
        )
        .select_related("incident__support_area", "incident__care_unit", "technician")
        .order_by("incident__code", "created_at", "id")
    )
    for closure in closures:
        survey = surveys.get(closure.pk)
        if survey:
            state = "Respondida"
        elif closure.incident.closing_intervention_id == closure.pk:
            state = "Pendiente"
        else:
            state = "No evaluada (reabierta)"
        yield [
            closure.incident.code,
            closure.incident.support_area.name,
            closure.incident.care_unit.name,
            closure.created_at,
            _name(closure.technician),
            state,
            survey.rating if survey else "",
            survey.comment if survey else "",
            survey.created_at if survey else None,
        ]


REPORTS: dict[str, tuple[str, Callable[[object], Iterable[list]]]] = {
    "incidents": ("Incidencias generales", _incidents_rows),
    "times": ("Tiempos de atención y cierre", _times_rows),
    "interventions": ("Intervenciones", _interventions_rows),
    "pending": ("Pendientes", _pending_rows),
    "verifications": ("Verificaciones y reaperturas", _verifications_rows),
    "satisfaction": ("Satisfacción del solicitante", _satisfaction_rows),
}


def build_report(slug: str, incidents, filters: Filters, scope_label: str) -> tuple[bytes, int]:
    """Genera el .xlsx. Devuelve el contenido y el número de filas de datos."""
    title, generator = REPORTS[slug]
    rows = generator(incidents)
    header = next(rows)
    data = []
    for row in rows:
        data.append(row)
        if len(data) > MAX_ROWS:
            raise ReportTooLarge(TOO_MANY_ROWS.format(max=MAX_ROWS, rows=f"más de {MAX_ROWS}"))

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = title[:31]
    sheet.append([safe_cell(f"SGIM-CMCH · {title}")])
    sheet.append(
        [
            safe_cell(
                f"Registradas del {filters.date_from:%d/%m/%Y} al {filters.date_to:%d/%m/%Y}"
                f" · Alcance: {scope_label}"
                + (f" · Área: {filters.area}" if filters.area else "")
                + (f" · Estado: {filters.status}" if filters.status else "")
            )
        ]
    )
    sheet.append([])
    sheet.append([safe_cell(column) for column in header])
    header_row = sheet.max_row
    for cell in sheet[header_row]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="9A1331")
    sheet["A1"].font = Font(bold=True, size=13)
    for row in data:
        sheet.append([safe_cell(value) for value in row])
    # Fuerza texto en las celdas de texto: ningún valor se interpreta como fórmula.
    for row in sheet.iter_rows(min_row=header_row + 1):
        for cell in row:
            if isinstance(cell.value, str):
                cell.data_type = "s"
            elif isinstance(cell.value, datetime):
                cell.number_format = "dd/mm/yyyy hh:mm"
    sheet.freeze_panes = sheet.cell(row=header_row + 1, column=1)
    for index, column in enumerate(header, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = max(14, min(48, len(column) + 6))

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue(), len(data)


def report_filename(slug: str, filters: Filters) -> str:
    return f"sgim-{slug}-{filters.date_from:%Y%m%d}-{filters.date_to:%Y%m%d}.xlsx"
