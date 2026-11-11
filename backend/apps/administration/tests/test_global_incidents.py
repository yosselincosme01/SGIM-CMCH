"""
Consulta global de incidencias del Administrador, de solo lectura y sin evidencia
(ADR 0009). También: funciones por área en ``/auth/me`` y filtro ``function`` de la
bandeja. Datos ficticios.
"""

import json

import pytest
from rest_framework import status

from apps.accounts.roles import Role

pytestmark = pytest.mark.django_db

LIST = "/api/v1/admin/incidents/"
ME = "/api/v1/auth/me/"
PLANNING = "/api/v1/incidents/planning/"


def detail(code):
    return f"{LIST}{code}/"


# --- Acceso -----------------------------------------------------------------------------


@pytest.mark.parametrize("who", ["planner", "superuser", "solicitante", "anon"])
def test_only_the_administrator_queries_all_incidents(client_for, make_user, builder, who):
    incident = builder.registered()
    user = {
        "planner": lambda: builder.planners["ti"],
        "superuser": lambda: make_user("root.prueba", is_superuser=True, is_staff=True),
        "solicitante": lambda: builder.requester,
        "anon": lambda: None,
    }[who]()
    client = client_for(user)

    assert client.get(LIST).status_code in (401, 403)
    assert client.get(detail(incident.code)).status_code in (401, 403)


# --- Lista y filtros -------------------------------------------------------------------


def test_admin_lists_incidents_of_every_area_with_filters(client_for, admin_user, builder):
    ti = builder.registered("ti", text="Monitor ficticio sin imagen")
    mant = builder.assigned("mantenimiento", text="Puerta ficticia atascada")
    closed = builder.intervene(builder.assigned("ti"))
    client = client_for(admin_user)

    everything = client.get(LIST).json()
    by_area = client.get(LIST, {"area": "mantenimiento"}).json()
    by_status = client.get(LIST, {"status": "cerrada"}).json()
    by_text = client.get(LIST, {"q": "monitor"}).json()

    assert {item["code"] for item in everything["results"]} == {ti.code, mant.code, closed.code}
    assert [item["code"] for item in by_area["results"]] == [mant.code]
    assert [item["code"] for item in by_status["results"]] == [closed.code]
    assert by_status["results"][0]["pending_verification"] is True
    assert [item["code"] for item in by_text["results"]] == [ti.code]
    assert client.get(LIST, {"status": "inventado"}).status_code == 400


# --- Detalle sin evidencia ni acciones ----------------------------------------------------


def test_detail_is_read_only_and_has_no_evidence(client_for, admin_user, builder):
    incident = builder.verify(builder.intervene(builder.assigned("ti")), "conforming")
    client = client_for(admin_user)

    response = client.get(detail(incident.code.lower()))

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == incident.code
    assert body["created_by"]["username"] == "sol.prueba"
    assert body["events"], "incluye el historial"
    assert body["closure"]["verification"]["result"] == "conforming"
    assert "permissions" not in body
    assert "attachments" not in body
    assert body["attachment_count"] == 0
    intervention = body["interventions"][0]
    assert intervention["diagnosis"] == "Diagnóstico ficticio."
    assert "photos" not in intervention
    assert intervention["photo_count"] == 1
    # Ningún enlace a archivos protegidos en toda la respuesta.
    assert "/attachments/" not in json.dumps(body)


def test_admin_still_cannot_download_evidence_or_act(client_for, admin_user, builder):
    incident = builder.intervene(builder.assigned("ti"))
    photo = incident.attachments.get()
    client = client_for(admin_user)

    assert (
        client.get(f"/api/v1/incidents/{incident.code}/attachments/{photo.pk}/").status_code == 404
    )
    assert client.get(f"/api/v1/incidents/{incident.code}/").status_code == 404
    verify = client.post(
        f"/api/v1/incidents/{incident.code}/verification/", {"result": "conforming"}, format="json"
    )
    assert verify.status_code in (403, 404)
    assert client.get(PLANNING).status_code == 403


def test_unknown_code_is_404(client_for, admin_user):
    assert client_for(admin_user).get(detail("INC-0000-9999")).status_code == 404


def test_write_methods_are_not_allowed(client_for, admin_user, builder):
    incident = builder.registered()
    client = client_for(admin_user)

    assert client.post(LIST, {}, format="json").status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    assert client.patch(detail(incident.code), {}, format="json").status_code == 405
    assert client.delete(detail(incident.code)).status_code == 405


# --- Opciones de auditoría -------------------------------------------------------------


def test_admin_options_include_audit_actions(client_for, admin_user):
    actions = client_for(admin_user).get("/api/v1/admin/options/").json()["audit_actions"]

    codes = {item["code"] for item in actions}
    assert {"user_created", "report_exported"} <= codes


# --- Funciones efectivas en /auth/me ---------------------------------------------------


def test_me_lists_effective_functions_by_area(client_for, make_user):
    user = make_user(
        "multi.prueba",
        Role.PLANIFICADOR,
        Role.PERSONAL_ATENCION,
        plans=("ti",),
        verifies=("mantenimiento",),
        assigned=("mantenimiento",),
    )

    body = client_for(user).get(ME).json()

    assert body["capabilities"] == {"can_plan": True, "can_attend": True, "can_verify": True}
    assert body["area_functions"] == [
        {
            "area": "mantenimiento",
            "area_name": "Mantenimiento",
            "can_plan": False,
            "can_attend": True,
            "can_verify": True,
        },
        {
            "area": "ti",
            "area_name": "TI",
            "can_plan": True,
            "can_attend": False,
            "can_verify": False,
        },
    ]


def test_me_ignores_functions_that_cannot_be_exercised(client_for, make_user):
    """Una pertenencia sin el rol exigido no aparece como función efectiva."""
    user = make_user("sin.rol", Role.SOLICITANTE, plans=("ti",), assigned=("ti",))

    body = client_for(user).get(ME).json()

    assert body["capabilities"] == {"can_plan": False, "can_attend": False, "can_verify": False}
    assert body["area_functions"] == []


def test_admin_me_has_no_operational_functions(client_for, admin_user):
    body = client_for(admin_user).get(ME).json()

    assert body["capabilities"] == {"can_plan": False, "can_attend": False, "can_verify": False}
    assert body["area_functions"] == []


# --- Filtro por función en la bandeja ---------------------------------------------------


def test_function_filter_separates_planning_and_verification(client_for, make_user, builder):
    """Planifica en Mantenimiento y verifica en TI: cada función ve solo lo suyo."""
    user = make_user("mixto.prueba", Role.PLANIFICADOR, plans=("mantenimiento",), verifies=("ti",))
    open_mant = builder.registered("mantenimiento")
    closed_ti = builder.intervene(builder.assigned("ti"))
    open_ti = builder.registered("ti")
    client = client_for(user)

    plan = {i["code"] for i in client.get(PLANNING, {"function": "plan"}).json()["results"]}
    verify = client.get(PLANNING, {"function": "verify"}).json()["results"]

    assert plan == {open_mant.code}
    assert [item["code"] for item in verify] == [closed_ti.code]
    assert verify[0]["pending_verification"] is True
    assert open_ti.code not in plan
    assert client.get(PLANNING, {"function": "otra"}).status_code == 400


def test_function_filter_does_not_widen_access(client_for, make_user, builder):
    only_verifier = make_user("solo.verifica", Role.SOLICITANTE, verifies=("ti",))
    builder.registered("ti")

    response = client_for(only_verifier).get(PLANNING, {"function": "plan"})

    assert response.status_code == 200
    assert response.json()["count"] == 0


# --- Filtro de periodo (fecha de registro, hora de Lima) --------------------------------


def test_period_filter_uses_lima_registration_days(client_for, admin_user, builder):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from apps.incidents.models import Incident

    lima = ZoneInfo("America/Lima")
    old = builder.registered("ti")
    recent = builder.registered("mantenimiento")
    # 23:30 del 1 de noviembre en Lima = 04:30 UTC del 2 de noviembre.
    Incident.objects.filter(pk=old.pk).update(created_at=datetime(2026, 11, 1, 23, 30, tzinfo=lima))
    Incident.objects.filter(pk=recent.pk).update(
        created_at=datetime(2026, 11, 5, 9, 0, tzinfo=lima)
    )
    client = client_for(admin_user)

    first_day = client.get(LIST, {"date_from": "2026-11-01", "date_to": "2026-11-01"}).json()
    from_second = client.get(LIST, {"date_from": "2026-11-02"}).json()
    until_fourth = client.get(LIST, {"date_to": "2026-11-04"}).json()

    assert [item["code"] for item in first_day["results"]] == [old.code]
    assert [item["code"] for item in from_second["results"]] == [recent.code]
    assert [item["code"] for item in until_fourth["results"]] == [old.code]


@pytest.mark.parametrize(
    "params",
    [{"date_from": "ayer"}, {"date_from": "2026-11-05", "date_to": "2026-11-01"}],
)
def test_period_filter_rejects_invalid_ranges(client_for, admin_user, params):
    assert client_for(admin_user).get(LIST, params).status_code == 400
