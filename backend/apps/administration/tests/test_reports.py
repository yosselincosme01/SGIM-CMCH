"""
Indicadores y reportes Excel: alcance global y restringido, cálculos sin dobles
conteos, filtros, seguridad de Excel, límites y auditoría (ADR 0007).
"""

import io
from datetime import timedelta

import pytest
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework import status

from apps.accounts.roles import Role
from apps.administration import reports
from apps.administration.models import AuditLog
from apps.incidents.models import Incident

pytestmark = pytest.mark.django_db

DASHBOARD = "/api/v1/reports/dashboard/"
OPTIONS = "/api/v1/reports/options/"


def export_url(slug, query=""):
    return f"/api/v1/reports/{slug}/export/{query}"


@pytest.fixture
def scenario(builder):
    """
    TI: una registrada, una en proceso (2 intervenciones), una cerrada y conforme.
    Mantenimiento: una reabierta tras No conforme.
    """
    registered = builder.registered("ti")
    in_progress = builder.assigned("ti")
    builder.intervene(in_progress, "in_progress")
    builder.intervene(in_progress, "not_solved")
    conforming = builder.verify(builder.intervene(builder.assigned("ti")), "conforming")
    reopened = builder.intervene(builder.assigned("mantenimiento"))
    builder.verify(reopened, "not_conforming", "La falla persiste (ficticio).")
    builder.reopen(reopened)
    return {
        "registered": registered,
        "in_progress": in_progress,
        "conforming": conforming,
        "reopened": reopened,
    }


def _sheet_rows(response):
    workbook = load_workbook(io.BytesIO(response.content))
    rows = list(workbook.active.iter_rows(values_only=True))
    return rows[3], rows[4:]  # encabezado y datos (las 3 primeras filas son el título)


# --- Alcance --------------------------------------------------------------------------


@pytest.mark.parametrize("who", ["solicitante", "tecnico", "superuser", "anon"])
def test_only_admin_and_planner_can_see_metrics(client_for, make_user, who):
    user = {
        "solicitante": lambda: make_user("sol.x", Role.SOLICITANTE),
        "tecnico": lambda: make_user("tec.x", Role.PERSONAL_ATENCION, assigned=("ti",)),
        "superuser": lambda: make_user("root.x", is_superuser=True, is_staff=True),
        "anon": lambda: None,
    }[who]()
    expected = 401 if who == "anon" else 403
    client = client_for(user)

    assert client.get(DASHBOARD).status_code == expected
    assert client.get(export_url("incidents")).status_code == expected
    assert not AuditLog.objects.filter(action="report_exported").exists()


def test_admin_sees_all_areas_planner_only_authorized(client_for, admin_user, builder, scenario):
    admin = client_for(admin_user).get(DASHBOARD).json()
    planner = client_for(builder.planners["ti"]).get(DASHBOARD).json()

    assert admin["scope"] == "global" and admin["tickets"]["total"] == 4
    assert planner["scope"] == "planner" and planner["tickets"]["total"] == 3
    assert {row["key"] for row in planner["by_area"]} == {"ti"}
    options = client_for(builder.planners["ti"]).get(OPTIONS).json()
    assert [a["code"] for a in options["areas"]] == ["ti"]


def test_planner_cannot_query_other_areas(client_for, builder, scenario):
    client = client_for(builder.planners["ti"])

    assert client.get(f"{DASHBOARD}?area=mantenimiento").status_code == 403
    assert client.get(export_url("incidents", "?area=mantenimiento")).status_code == 403


def test_global_visibility_does_not_grant_operational_permissions(client_for, admin_user, scenario):
    client = client_for(admin_user)
    code = scenario["registered"].code

    assert client.get(f"/api/v1/incidents/{code}/").status_code == 404
    assert client.get("/api/v1/incidents/planning/").status_code == 403
    assert client.get("/api/v1/incidents/attention/").status_code == 403


# --- Cálculos -------------------------------------------------------------------------


def test_metrics_count_tickets_cycles_and_interventions_separately(
    client_for, admin_user, scenario
):
    body = client_for(admin_user).get(DASHBOARD).json()

    assert body["tickets"] == {
        "total": 4,
        "open": 3,  # registrada, asignada (en proceso) y reabierta
        "pending_management": 2,  # registrada + reabierta
        "in_progress": 1,  # una sola vez aunque tenga 2 intervenciones
        "closed": 1,
        "pending_verification": 0,
        "reopened": 1,
    }
    assert body["cycles"] == {"conforming": 1, "not_conforming": 1, "reopenings": 1}
    assert body["interventions"]["total"] == 4
    assert {r["key"]: r["total"] for r in body["interventions"]["by_result"]} == {
        "in_progress": 1,
        "not_solved": 1,
        "solved": 2,
    }
    assert {r["key"]: r["total"] for r in body["by_status"]} == {
        "registrada": 1,
        "asignada": 1,
        "cerrada": 1,
        "reabierta": 1,
    }
    assert body["times"]["tickets_with_intervention"] == 3
    assert body["times"]["closed_tickets_measured"] == 1
    assert body["times"]["avg_hours_to_closure"] is not None


def test_pending_verification_is_counted(client_for, admin_user, builder):
    builder.intervene(builder.assigned("ti"))

    body = client_for(admin_user).get(DASHBOARD).json()

    assert body["tickets"]["closed"] == 1
    assert body["tickets"]["pending_verification"] == 1


def test_filters_by_date_area_and_status(client_for, admin_user, scenario):
    old = scenario["registered"]
    Incident.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=90))
    client = client_for(admin_user)

    assert client.get(DASHBOARD).json()["tickets"]["total"] == 3  # últimos 30 días
    wide = client.get(f"{DASHBOARD}?date_from={(timezone.localdate() - timedelta(days=120))}")
    assert wide.json()["tickets"]["total"] == 4
    assert client.get(f"{DASHBOARD}?area=mantenimiento").json()["tickets"]["total"] == 1
    assert client.get(f"{DASHBOARD}?status=cerrada").json()["tickets"]["total"] == 1


@pytest.mark.parametrize(
    "query",
    [
        "?date_from=2026-13-01",
        "?date_from=2026-11-10&date_to=2026-11-01",
        "?date_from=2024-01-01&date_to=2026-01-01",
        "?status=inventado",
    ],
)
def test_invalid_filters_are_rejected(client_for, admin_user, query):
    assert client_for(admin_user).get(f"{DASHBOARD}{query}").status_code == 400


# --- Reportes Excel ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("slug", "first_header", "rows"),
    [
        ("incidents", "Código", 4),
        ("times", "Código", 4),
        ("interventions", "Código", 4),
        ("pending", "Código", 1),
        ("verifications", "Código", 2),
    ],
)
def test_each_report_downloads_a_real_xlsx_and_is_audited(
    client_for, admin_user, scenario, slug, first_header, rows
):
    response = client_for(admin_user).get(export_url(slug))

    assert response.status_code == 200
    assert response["Content-Type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert response["Content-Disposition"].startswith('attachment; filename="sgim-')
    assert response["Cache-Control"] == "private, no-store"
    header, data = _sheet_rows(response)
    assert header[0] == first_header
    assert len(data) == rows
    log = AuditLog.objects.get(action="report_exported")
    assert log.actor == admin_user
    assert log.details["report"] == slug and log.details["rows"] == rows
    assert log.details["scope"] == "global"


def test_planner_exports_only_authorized_areas(client_for, builder, scenario):
    response = client_for(builder.planners["mantenimiento"]).get(export_url("incidents"))

    _, data = _sheet_rows(response)
    assert [row[0] for row in data] == [scenario["reopened"].code]
    assert AuditLog.objects.get(action="report_exported").details["scope"] == "planner"


def test_verifications_report_links_reopenings(client_for, admin_user, scenario):
    _, data = _sheet_rows(client_for(admin_user).get(export_url("verifications")))
    by_code = {row[0]: row for row in data}

    reopened = by_code[scenario["reopened"].code]
    assert reopened[4] == "No conforme"
    assert reopened[8] == "Sí"
    assert reopened[9] == "Reapertura ficticia suficiente."
    assert by_code[scenario["conforming"].code][8] == "No"


def test_excel_formula_injection_is_neutralized(client_for, admin_user, builder):
    incident = builder.assigned("ti")
    builder.intervene(
        incident,
        "in_progress",
        diagnosis='=HYPERLINK("http://malicioso.test","clic")',
        actions_taken="+cmd|' /C calc'!A0",
        unresolved_reason="@SUM(1+1) y otros datos",
        observations="-2+3",
    )

    response = client_for(admin_user).get(export_url("interventions"))

    workbook = load_workbook(io.BytesIO(response.content))
    sheet = workbook.active
    data_row = list(sheet.iter_rows(min_row=5, max_row=5))[0]
    texts = {cell.value for cell in data_row if isinstance(cell.value, str)}
    for dangerous in (
        '=HYPERLINK("http://malicioso.test","clic")',
        "+cmd|' /C calc'!A0",
        "@SUM(1+1) y otros datos",
        "-2+3",
    ):
        assert dangerous not in texts
        assert "'" + dangerous in texts
    assert all(cell.data_type != "f" for cell in data_row)


def test_safe_cell_handles_control_characters_and_types():
    assert reports.safe_cell("texto\x00con\x07control") == "textoconcontrol"
    assert reports.safe_cell("=1+1") == "'=1+1"
    assert reports.safe_cell(True) == "Sí"
    assert reports.safe_cell(None) == ""
    assert reports.safe_cell(3) == 3


def test_reports_do_not_export_secrets(client_for, admin_user, builder, scenario):
    response = client_for(admin_user).get(export_url("incidents"))
    workbook = load_workbook(io.BytesIO(response.content))
    text = str(list(workbook.active.iter_rows(values_only=True)))

    assert "@example.test" not in text  # sin correos
    assert "pbkdf2" not in text and "md5" not in text  # sin hashes de contraseña
    assert builder.requester.full_name in text  # solo el nombre del solicitante


def test_download_limit(client_for, admin_user, scenario, monkeypatch):
    monkeypatch.setattr(reports, "MAX_ROWS", 2)

    response = client_for(admin_user).get(export_url("incidents"))

    assert response.status_code == 400
    assert "supera" in str(response.json()["detail"])
    assert not AuditLog.objects.filter(action="report_exported").exists()


def test_unknown_report_is_404(client_for, admin_user):
    assert (
        client_for(admin_user).get(export_url("secretos")).status_code == status.HTTP_404_NOT_FOUND
    )
