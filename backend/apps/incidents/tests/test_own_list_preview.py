"""
Vista previa de la descripción en «Mis incidencias» (GET /incidents/?scope=mine): solo
incidencias propias, recortada a unos 100 caracteres, sin datos técnicos ni consultas
N+1. Datos ficticios.
"""

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.accounts.roles import Role
from apps.incidents.serializers import DESCRIPTION_PREVIEW_MAX
from apps.incidents.services import create_incident

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/incidents/"


def _incident(user, care_unit, area, description):
    return create_incident(
        user=user,
        care_unit=care_unit,
        support_area=area,
        description=description,
        equipment_qr_status="qr_readable",
        qr_code="QR-FICTICIO-LISTA",
    )


def test_own_list_includes_a_short_description(client_for, solicitante, care_unit, area_ti):
    _incident(solicitante, care_unit, area_ti, "El monitor de\n  triaje   no enciende.")

    item = client_for(solicitante).get(LIST_URL).json()["results"][0]

    assert item["description_preview"] == "El monitor de triaje no enciende."
    # Se conservan los campos anteriores.
    assert {"code", "status", "status_label", "care_unit", "support_area", "created_at"} <= set(
        item
    )


def test_long_descriptions_are_truncated(client_for, solicitante, care_unit, area_ti):
    long_text = "Falla de iluminación en el consultorio ficticio número tres. " * 5
    _incident(solicitante, care_unit, area_ti, long_text)

    preview = client_for(solicitante).get(LIST_URL).json()["results"][0]["description_preview"]

    assert len(preview) <= DESCRIPTION_PREVIEW_MAX
    assert preview.endswith("…")
    assert long_text.startswith(preview[:-1].rstrip())


def test_preview_never_includes_technical_data(client_for, solicitante, care_unit, area_ti):
    _incident(solicitante, care_unit, area_ti, "Impresora sin conexión (ficticio).")

    item = client_for(solicitante).get(LIST_URL).json()["results"][0]

    for field in ("attachments", "interventions", "diagnosis", "events", "description"):
        assert field not in item


def test_only_own_incidents_are_listed(
    client_for, solicitante, otro_solicitante, care_unit, area_ti
):
    _incident(otro_solicitante, care_unit, area_ti, "Descripción ajena que no debe verse.")
    _incident(solicitante, care_unit, area_ti, "Mi propia incidencia ficticia.")

    results = client_for(solicitante).get(LIST_URL).json()["results"]

    assert [item["description_preview"] for item in results] == ["Mi propia incidencia ficticia."]


def test_area_scope_does_not_add_the_preview(
    client_for, make_user, solicitante, care_unit, area_ti
):
    planner = make_user("plan.lista", Role.PLANIFICADOR, plans=("ti",))
    _incident(solicitante, care_unit, area_ti, "Incidencia del área (ficticia).")

    item = client_for(planner).get(LIST_URL, {"scope": "area"}).json()["results"][0]

    assert "description_preview" not in item


def test_pagination_and_ordering_are_unchanged(client_for, solicitante, care_unit, area_ti):
    created = [
        _incident(solicitante, care_unit, area_ti, f"Incidencia ficticia {index}.")
        for index in range(22)
    ]
    client = client_for(solicitante)

    first = client.get(LIST_URL).json()
    second = client.get(LIST_URL, {"page": 2}).json()

    assert first["count"] == 22 and len(first["results"]) == 20 and len(second["results"]) == 2
    assert first["results"][0]["code"] == created[-1].code  # la más reciente primero


def test_preview_does_not_add_queries_per_incident(client_for, solicitante, care_unit, area_ti):
    client = client_for(solicitante)
    _incident(solicitante, care_unit, area_ti, "Primera incidencia ficticia.")
    with CaptureQueriesContext(connection) as one:
        client.get(LIST_URL)
    for index in range(5):
        _incident(solicitante, care_unit, area_ti, f"Otra incidencia ficticia {index}.")
    with CaptureQueriesContext(connection) as six:
        client.get(LIST_URL)

    assert len(six.captured_queries) == len(one.captured_queries)
