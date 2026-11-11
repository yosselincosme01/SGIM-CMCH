"""
Indicadores y reporte de satisfacción del solicitante (ADR 0012): tasa de respuesta
sobre cierres técnicos elegibles, sin duplicados ni interpretar la falta de respuesta
como insatisfacción; alcance por área y periodo. Datos ficticios.
"""

import io
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from openpyxl import load_workbook

from apps.accounts.roles import Role
from apps.incidents import survey_services
from apps.incidents.models import Incident

pytestmark = pytest.mark.django_db

DASHBOARD = "/api/v1/reports/dashboard/"


def export(slug):
    return f"/api/v1/reports/{slug}/export/"


def answer(builder, incident, rating, comment=""):
    survey_services.submit_survey(
        incident=incident,
        actor=builder.requester,
        closing_intervention_id=incident.closing_intervention_id,
        rating=rating,
        comment=comment,
    )


@pytest.fixture
def scenario(builder):
    """
    TI:
      - A: cerrada y evaluada con 5.
      - B: cerrada, evaluada con 2, reabierta y vuelta a cerrar sin evaluar (pendiente).
      - C: cerrada y reabierta sin evaluar (cierre no evaluable), sigue abierta.
      - D: registrada, sin cierre.
    Mantenimiento:
      - E: cerrada y evaluada con 4.
    """
    a = builder.intervene(builder.assigned("ti"))
    answer(builder, a, 5, "Rápido y amable.")

    b = builder.intervene(builder.assigned("ti"))
    answer(builder, b, 2)
    builder.reopen(builder.verify(b, "not_conforming", "La falla volvió."))
    b = builder.intervene(builder.assigned_again(b))

    c = builder.intervene(builder.assigned("ti"))
    builder.reopen(builder.verify(c, "not_conforming", "No quedó operativo."))

    d = builder.registered("ti")
    e = builder.intervene(builder.assigned("mantenimiento"))
    answer(builder, e, 4)
    return {"a": a, "b": b, "c": c, "d": d, "e": e}


def test_dashboard_counts_closures_answers_and_rate(client_for, admin_user, scenario):
    body = client_for(admin_user).get(DASHBOARD).json()

    # Cierres: A, B(1), B(2), C, E = 5. Respondidas: A, B(1), E = 3.
    assert body["satisfaction"] == {
        "eligible": 5,
        "answered": 3,
        "pending": 1,  # B(2), cierre vigente sin respuesta
        "expired": 1,  # C, reabierta sin respuesta
        "average": round((5 + 2 + 4) / 3, 2),
        "response_rate": 60.0,
    }


def test_dashboard_respects_area_and_period(client_for, admin_user, scenario):
    client = client_for(admin_user)

    ti = client.get(DASHBOARD, {"area": "ti"}).json()["satisfaction"]
    mant = client.get(DASHBOARD, {"area": "mantenimiento"}).json()["satisfaction"]

    assert (ti["eligible"], ti["answered"], ti["average"]) == (4, 2, 3.5)
    assert (mant["eligible"], mant["answered"], mant["average"]) == (1, 1, 4.0)
    old = datetime(2025, 1, 15, 10, 0, tzinfo=ZoneInfo("America/Lima"))
    Incident.objects.filter(pk=scenario["e"].pk).update(created_at=old)
    in_period = client.get(DASHBOARD).json()["satisfaction"]
    assert in_period["eligible"] == 4  # E quedó fuera del periodo por defecto


def test_no_answers_is_not_dissatisfaction(client_for, admin_user, builder):
    builder.intervene(builder.assigned("ti"))

    body = client_for(admin_user).get(DASHBOARD).json()["satisfaction"]

    assert body == {
        "eligible": 1,
        "answered": 0,
        "pending": 1,
        "expired": 0,
        "average": None,
        "response_rate": 0.0,
    }


def test_without_closures_there_is_no_rate(client_for, admin_user, builder):
    builder.registered("ti")

    body = client_for(admin_user).get(DASHBOARD).json()["satisfaction"]

    assert body["eligible"] == 0
    assert body["response_rate"] is None and body["average"] is None


def test_planner_only_sees_its_areas(client_for, builder, scenario):
    planner = builder.planners["mantenimiento"]

    body = client_for(planner).get(DASHBOARD).json()["satisfaction"]

    assert (body["eligible"], body["answered"]) == (1, 1)


def test_satisfaction_report_has_one_row_per_closure(client_for, admin_user, scenario):
    response = client_for(admin_user).get(export("satisfaction"))

    assert response.status_code == 200
    sheet = load_workbook(io.BytesIO(response.content)).active
    rows = [[cell.value for cell in row] for row in sheet.iter_rows(min_row=1) if row[0].value]
    header_index = next(i for i, row in enumerate(rows) if row[0] == "Código")
    data = rows[header_index + 1 :]
    states = sorted((row[0], row[5], row[6]) for row in data)
    a, b, c, e = (scenario[key].code for key in "abce")
    assert len(data) == 5
    assert states == sorted(
        [
            (a, "Respondida", 5),
            (b, "Respondida", 2),
            (b, "Pendiente", None),
            (c, "No evaluada (reabierta)", None),
            (e, "Respondida", 4),
        ]
    )


def test_satisfaction_report_protects_comments_against_formulas(client_for, admin_user, builder):
    incident = builder.intervene(builder.assigned("ti"))
    answer(builder, incident, 3, '=HYPERLINK("http://ejemplo.invalid")')

    response = client_for(admin_user).get(export("satisfaction"))

    sheet = load_workbook(io.BytesIO(response.content)).active
    comments = [row[7].value for row in sheet.iter_rows() if row[0].value == incident.code]
    assert comments == ['\'=HYPERLINK("http://ejemplo.invalid")']


def test_report_options_list_the_satisfaction_report(client_for, admin_user):
    reports = client_for(admin_user).get("/api/v1/reports/options/").json()["reports"]

    assert {"code": "satisfaction", "label": "Satisfacción del solicitante"} in reports


@pytest.mark.parametrize("who", ["tech", "solicitante", "verifier"])
def test_report_is_not_available_without_report_access(client_for, make_user, builder, who):
    user = {
        "tech": lambda: builder.techs["ti"],
        "solicitante": lambda: builder.requester,
        "verifier": lambda: make_user("solo.verifica", Role.SOLICITANTE, verifies=("ti",)),
    }[who]()

    assert client_for(user).get(export("satisfaction")).status_code == 403
