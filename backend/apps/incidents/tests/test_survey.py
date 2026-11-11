"""
Encuesta de satisfacción del solicitante (ADR 0012): disponibilidad tras el cierre,
acceso exclusivo del solicitante, validación, duplicados, concurrencia, historial tras
reaperturas, independencia de la verificación y visibilidad por permisos. Datos
ficticios.
"""

import threading
from datetime import timedelta

import pytest
from django.core.exceptions import PermissionDenied
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework import status

from apps.accounts.roles import Role
from apps.incidents import survey_services
from apps.incidents.models import Incident, IncidentVerification, SatisfactionSurvey
from apps.incidents.planning_services import PlanningConflict
from apps.incidents.services import create_incident

from .conftest import image_bytes, upload

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/incidents/"


def detail(code):
    return f"{LIST_URL}{code}/"


def survey_url(code):
    return f"{detail(code)}survey/"


def future(days=1):
    return (timezone.localtime() + timedelta(days=days)).replace(second=0, microsecond=0)


# --- Personas y flujo (ficticios) -----------------------------------------------------


@pytest.fixture
def planner(make_user):
    return make_user("plan.encuesta", Role.PLANIFICADOR, plans=("ti",), verifies=("ti",))


@pytest.fixture
def tech(make_user):
    return make_user("tec.encuesta", Role.PERSONAL_ATENCION, assigned=("ti",))


@pytest.fixture
def incident(solicitante, care_unit, area_ti):
    return create_incident(
        user=solicitante,
        care_unit=care_unit,
        support_area=area_ti,
        description="El lector de códigos de farmacia no responde (ficticio).",
        equipment_qr_status="qr_readable",
        qr_code="QR-FICTICIO-ENC",
    )


def _schedule(client_for, planner, tech, incident):
    payload = {
        "priority": "alta",
        "technician": tech.username,
        "scheduled_at": future().isoformat(),
    }
    response = client_for(planner).post(f"{detail(incident.code)}planning/", payload, format="json")
    assert response.status_code == 200, response.json()
    incident.refresh_from_db()


def _solve(client_for, tech, incident):
    assignment = incident.assignments.get(is_current=True)
    payload = {
        "assignment": assignment.pk,
        "diagnosis": "Cable dañado (ficticio).",
        "actions_taken": "Se reemplazó el cable.",
        "result": "solved",
        "used_parts": "false",
        "parts_required": "false",
        "photos": [upload("evidencia.png", image_bytes("PNG"))],
    }
    response = client_for(tech).post(
        f"{detail(incident.code)}interventions/", payload, format="multipart"
    )
    assert response.status_code == 201, response.json()
    incident.refresh_from_db()


def _close(client_for, planner, tech, incident):
    _schedule(client_for, planner, tech, incident)
    _solve(client_for, tech, incident)
    return incident


@pytest.fixture
def closed(client_for, planner, tech, incident):
    return _close(client_for, planner, tech, incident)


def _answer(client, incident, rating=5, comment="", closure=None):
    payload = {"closure": closure or incident.closing_intervention_id, "rating": rating}
    if comment:
        payload["comment"] = comment
    return client.post(survey_url(incident.code), payload, format="json")


def _reopen(client_for, planner, incident):
    client = client_for(planner)
    verify = client.post(
        f"{detail(incident.code)}verification/",
        {"result": "not_conforming", "observations": "La falla continúa."},
        format="json",
    )
    assert verify.status_code == 200, verify.json()
    reopen = client.post(
        f"{detail(incident.code)}reopen/",
        {"reason": "Persiste la falla del lector."},
        format="json",
    )
    assert reopen.status_code == 200, reopen.json()
    incident.refresh_from_db()


# --- Disponibilidad -------------------------------------------------------------------------


def test_survey_is_available_after_the_technical_closure(client_for, solicitante, closed):
    body = client_for(solicitante).get(survey_url(closed.code)).json()

    assert body["pending"]["closure"] == closed.closing_intervention_id
    assert body["pending"]["closed_at"]
    assert body["history"] == []


def test_no_survey_before_the_closure(client_for, planner, tech, solicitante, incident):
    client = client_for(solicitante)
    assert client.get(survey_url(incident.code)).json()["pending"] is None

    _schedule(client_for, planner, tech, incident)
    assert client.get(survey_url(incident.code)).json()["pending"] is None
    response = client.post(survey_url(incident.code), {"closure": 1, "rating": 5}, format="json")

    assert response.status_code == status.HTTP_409_CONFLICT
    assert not SatisfactionSurvey.objects.exists()


def test_does_not_wait_for_the_verification(client_for, solicitante, closed):
    assert not IncidentVerification.objects.exists()

    response = _answer(client_for(solicitante), closed, rating=4)

    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()["pending"] is None
    assert response.json()["history"][0]["rating"] == 4


# --- Acceso exclusivo del solicitante -------------------------------------------------------


def test_another_worker_cannot_see_or_answer(client_for, otro_solicitante, closed):
    client = client_for(otro_solicitante)

    assert client.get(survey_url(closed.code)).status_code == status.HTTP_404_NOT_FOUND
    assert _answer(client, closed).status_code == status.HTTP_404_NOT_FOUND
    assert not SatisfactionSurvey.objects.exists()


@pytest.mark.parametrize("who", ["planner", "tech"])
def test_area_staff_cannot_answer_for_the_requester(client_for, planner, tech, closed, who):
    client = client_for({"planner": planner, "tech": tech}[who])

    assert client.get(survey_url(closed.code)).status_code == status.HTTP_403_FORBIDDEN
    assert _answer(client, closed).status_code == status.HTTP_403_FORBIDDEN
    assert not SatisfactionSurvey.objects.exists()


def test_admin_and_superuser_cannot_answer(client_for, make_user, closed):
    for user in (
        make_user("admin.encuesta", Role.ADMINISTRADOR),
        make_user("root.encuesta", is_superuser=True),
    ):
        assert _answer(client_for(user), closed).status_code in (403, 404)
    assert not SatisfactionSurvey.objects.exists()


def test_requester_who_lost_every_operational_role_cannot_answer(client_for, solicitante, closed):
    solicitante.groups.clear()

    assert _answer(client_for(solicitante), closed).status_code == status.HTTP_404_NOT_FOUND


def test_anonymous_is_rejected(client_for, closed):
    assert client_for(None).get(survey_url(closed.code)).status_code in (401, 403)


def test_service_enforces_the_requester(tech, closed):
    with pytest.raises(PermissionDenied):
        survey_services.submit_survey(
            incident=closed,
            actor=tech,
            closing_intervention_id=closed.closing_intervention_id,
            rating=5,
        )


def test_requires_csrf(client_for, solicitante, closed):
    client = client_for(solicitante, enforce_csrf=True)

    assert _answer(client, closed).status_code == status.HTTP_403_FORBIDDEN


# --- Validación -------------------------------------------------------------------------------


@pytest.mark.parametrize("rating", [1, 5])
def test_valid_ratings(client_for, solicitante, closed, rating):
    assert _answer(client_for(solicitante), closed, rating=rating).status_code == 201
    assert SatisfactionSurvey.objects.get().rating == rating


@pytest.mark.parametrize("rating", [0, 6, -1, "excelente", None, 4.5, True])
def test_invalid_ratings_are_rejected(client_for, solicitante, closed, rating):
    response = client_for(solicitante).post(
        survey_url(closed.code),
        {"closure": closed.closing_intervention_id, "rating": rating},
        format="json",
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "rating" in response.json()
    assert not SatisfactionSurvey.objects.exists()


def test_comment_is_optional_and_trimmed(client_for, solicitante, closed):
    response = _answer(client_for(solicitante), closed, rating=3, comment="  Muy amables.  ")

    assert response.status_code == 201
    assert SatisfactionSurvey.objects.get().comment == "Muy amables."


def test_long_comment_and_unknown_fields_are_rejected(client_for, solicitante, closed):
    client = client_for(solicitante)
    too_long = _answer(client, closed, comment="x" * 1001)
    extra = client.post(
        survey_url(closed.code),
        {"closure": closed.closing_intervention_id, "rating": 5, "respondent": 1},
        format="json",
    )

    assert too_long.status_code == 400 and "comment" in too_long.json()
    assert extra.status_code == 400
    assert not SatisfactionSurvey.objects.exists()


def test_database_rejects_invalid_ratings(solicitante, closed):
    with pytest.raises(IntegrityError), transaction.atomic():
        SatisfactionSurvey.objects.create(
            incident=closed,
            closing_intervention=closed.closing_intervention,
            respondent=solicitante,
            rating=6,
        )


# --- Duplicados y concurrencia -------------------------------------------------------------


def test_duplicate_submissions_are_rejected(client_for, solicitante, closed):
    client = client_for(solicitante)

    first = _answer(client, closed, rating=5)
    second = _answer(client, closed, rating=1)

    assert first.status_code == 201
    assert second.status_code == status.HTTP_409_CONFLICT
    assert SatisfactionSurvey.objects.get().rating == 5  # nunca se sobrescribe


def test_database_allows_one_survey_per_closure(solicitante, closed):
    SatisfactionSurvey.objects.create(
        incident=closed,
        closing_intervention=closed.closing_intervention,
        respondent=solicitante,
        rating=4,
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        SatisfactionSurvey.objects.create(
            incident=closed,
            closing_intervention=closed.closing_intervention,
            respondent=solicitante,
            rating=2,
        )


def test_a_race_lost_at_write_time_is_a_conflict(solicitante, closed, monkeypatch):
    """Si otra petición escribe entre la comprobación y el guardado, responde 409."""

    def raise_integrity(**kwargs):
        raise IntegrityError("duplicate key")

    monkeypatch.setattr(SatisfactionSurvey.objects, "create", raise_integrity)

    with pytest.raises(PlanningConflict):
        survey_services.submit_survey(
            incident=closed,
            actor=solicitante,
            closing_intervention_id=closed.closing_intervention_id,
            rating=5,
        )


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.skipif(
    connection.vendor != "postgresql", reason="Concurrencia real solo en PostgreSQL"
)
def test_concurrent_submissions_store_a_single_survey(
    client_for, solicitante, planner, tech, incident
):
    closed = _close(client_for, planner, tech, incident)
    results = []

    def submit(rating):
        try:
            survey_services.submit_survey(
                incident=closed,
                actor=solicitante,
                closing_intervention_id=closed.closing_intervention_id,
                rating=rating,
            )
            results.append("ok")
        except PlanningConflict:
            results.append("conflict")
        finally:
            connection.close()

    threads = [threading.Thread(target=submit, args=(rating,)) for rating in (5, 1)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results) == ["conflict", "ok"]
    assert SatisfactionSurvey.objects.count() == 1


def test_stale_closure_is_a_conflict(client_for, solicitante, closed):
    response = _answer(client_for(solicitante), closed, closure=closed.closing_intervention_id + 99)

    assert response.status_code == status.HTTP_409_CONFLICT
    assert not SatisfactionSurvey.objects.exists()


# --- Reaperturas e historial -----------------------------------------------------------------


def test_reopening_keeps_the_answered_survey_and_a_new_closure_gets_a_new_one(
    client_for, solicitante, planner, tech, closed
):
    client = client_for(solicitante)
    first_closure = closed.closing_intervention_id
    assert _answer(client, closed, rating=2, comment="Volvió a fallar.").status_code == 201

    _reopen(client_for, planner, closed)
    assert client.get(survey_url(closed.code)).json()["pending"] is None
    _close(client_for, planner, tech, closed)

    pending = client.get(survey_url(closed.code)).json()["pending"]
    assert pending["closure"] != first_closure
    assert _answer(client, closed, rating=5).status_code == 201

    history = client.get(survey_url(closed.code)).json()["history"]
    assert [(item["closure"], item["rating"]) for item in history] == [
        (closed.closing_intervention_id, 5),
        (first_closure, 2),
    ]
    assert SatisfactionSurvey.objects.get(closing_intervention_id=first_closure).comment == (
        "Volvió a fallar."
    )


def test_an_unanswered_closure_stops_being_evaluable_after_reopening(
    client_for, solicitante, planner, closed
):
    previous = closed.closing_intervention_id
    _reopen(client_for, planner, closed)

    client = client_for(solicitante)
    assert client.get(survey_url(closed.code)).json()["pending"] is None
    response = _answer(client, closed, closure=previous)

    assert response.status_code == status.HTTP_409_CONFLICT
    assert not SatisfactionSurvey.objects.exists()


# --- Independencia de la verificación técnica ------------------------------------------------


def test_survey_does_not_change_the_incident_or_the_verification(
    client_for, solicitante, planner, closed
):
    events_before = closed.events.count()

    _answer(client_for(solicitante), closed, rating=1, comment="Insatisfecho.")

    closed.refresh_from_db()
    assert closed.status == Incident.Status.CERRADA
    assert not IncidentVerification.objects.exists()
    assert closed.events.count() == events_before
    # El Responsable de Área sigue pudiendo verificar como "Conforme".
    verify = client_for(planner).post(
        f"{detail(closed.code)}verification/", {"result": "conforming"}, format="json"
    )
    assert verify.status_code == 200


def test_requester_can_answer_after_a_not_conforming_verification(
    client_for, solicitante, planner, closed
):
    client_for(planner).post(
        f"{detail(closed.code)}verification/",
        {"result": "not_conforming", "observations": "Falta probar el equipo."},
        format="json",
    )

    assert _answer(client_for(solicitante), closed, rating=3).status_code == 201
    closed.refresh_from_db()
    assert closed.status == Incident.Status.CERRADA  # no se reabre sola


# --- Visibilidad de las evaluaciones ------------------------------------------------------------


def test_area_planner_and_verifier_see_the_evaluations(
    client_for, make_user, solicitante, planner, closed
):
    _answer(client_for(solicitante), closed, rating=4, comment="Atención rápida.")
    verifier = make_user("solo.verifica", Role.SOLICITANTE, verifies=("ti",))

    for user in (planner, verifier):
        surveys = client_for(user).get(detail(closed.code)).json()["surveys"]
        assert [(s["rating"], s["comment"]) for s in surveys] == [(4, "Atención rápida.")]


def test_technician_does_not_see_the_evaluations(client_for, solicitante, tech, closed):
    _answer(client_for(solicitante), closed, rating=4, comment="Atención rápida.")

    assert client_for(tech).get(detail(closed.code)).json()["surveys"] == []


def test_role_without_area_function_grants_nothing(client_for, make_user, solicitante, closed):
    _answer(client_for(solicitante), closed, rating=4)
    other_area = make_user(
        "plan.mant", Role.PLANIFICADOR, plans=("mantenimiento",), verifies=("mantenimiento",)
    )
    role_only = make_user("plan.sin.area", Role.PLANIFICADOR)

    for user in (other_area, role_only):
        assert client_for(user).get(detail(closed.code)).status_code == 404


def test_admin_sees_the_evaluations_in_the_read_only_query(
    client_for, make_user, solicitante, closed
):
    _answer(client_for(solicitante), closed, rating=5, comment="Excelente.")
    admin = make_user("admin.lee", Role.ADMINISTRADOR)

    body = client_for(admin).get(f"/api/v1/admin/incidents/{closed.code}/").json()

    assert [(s["rating"], s["comment"]) for s in body["surveys"]] == [(5, "Excelente.")]


def test_requester_detail_does_not_expose_other_fields(client_for, solicitante, closed):
    body = client_for(solicitante).get(detail(closed.code)).json()

    assert "surveys" not in body  # el solicitante usa su propio endpoint


# --- Mis incidencias e Inicio -------------------------------------------------------------------


def test_my_incidents_flags_pending_surveys(client_for, solicitante, incident, closed):
    client = client_for(solicitante)
    other = create_incident(
        user=solicitante,
        care_unit=closed.care_unit,
        support_area=closed.support_area,
        description="Otra incidencia ficticia sin cierre.",
        equipment_qr_status="qr_readable",
        qr_code="QR-FICTICIO-2",
    )

    flags = {i["code"]: i["survey_pending"] for i in client.get(LIST_URL).json()["results"]}
    assert flags == {closed.code: True, other.code: False}
    assert client.get("/api/v1/incidents/summary/").json()["surveys"] == {"pending": 1}

    _answer(client, closed)
    flags = {i["code"]: i["survey_pending"] for i in client.get(LIST_URL).json()["results"]}
    assert flags[closed.code] is False
    assert client.get("/api/v1/incidents/summary/").json()["surveys"] == {"pending": 0}


# --- Recordatorio al iniciar sesión (una vez por sesión) ---------------------------------

REMINDER = "/api/v1/incidents/survey-reminder/"


def test_reminder_shows_pending_surveys_once_per_session(client_for, solicitante, closed):
    client = client_for(solicitante)

    first = client.get(REMINDER).json()
    assert first == {
        "show": True,
        "total": 1,
        "items": [{"code": closed.code, "closed_at": first["items"][0]["closed_at"]}],
    }
    assert client.post(REMINDER).status_code == status.HTTP_204_NO_CONTENT

    # Navegar o recargar (misma sesión): no se repite, pero sigue pendiente.
    again = client.get(REMINDER).json()
    assert again["show"] is False and again["total"] == 1
    assert not SatisfactionSurvey.objects.exists()  # mostrarlo no registra respuestas


def test_reminder_returns_after_a_new_login(client_for, solicitante, closed):
    client = client_for(solicitante)
    client.post(REMINDER)

    client.logout()
    client.force_login(solicitante)

    assert client.get(REMINDER).json()["show"] is True


def test_reminder_mark_does_not_pass_to_another_account(
    client_for, make_user, solicitante, care_unit, area_ti, planner, tech, closed
):
    other = make_user("otro.solicitante", Role.SOLICITANTE)
    other_incident = create_incident(
        user=other,
        care_unit=care_unit,
        support_area=area_ti,
        description="Incidencia ficticia de otra persona.",
        equipment_qr_status="qr_readable",
        qr_code="QR-OTRO",
    )
    _close(client_for, planner, tech, other_incident)
    client = client_for(solicitante)
    client.post(REMINDER)

    # Cambio de cuenta en el mismo navegador: Django crea una sesión nueva.
    client.logout()
    client.force_login(other)
    body = client.get(REMINDER).json()

    assert body["show"] is True
    assert [item["code"] for item in body["items"]] == [other_incident.code]


def test_reminder_lists_only_own_current_evaluable_closures(
    client_for, solicitante, planner, tech, care_unit, area_ti, closed
):
    answered = create_incident(
        user=solicitante,
        care_unit=care_unit,
        support_area=area_ti,
        description="Incidencia ficticia ya evaluada.",
        equipment_qr_status="qr_readable",
        qr_code="QR-EVAL",
    )
    _close(client_for, planner, tech, answered)
    _answer(client_for(solicitante), answered, rating=5)
    reopened = create_incident(
        user=solicitante,
        care_unit=care_unit,
        support_area=area_ti,
        description="Incidencia ficticia reabierta.",
        equipment_qr_status="qr_readable",
        qr_code="QR-REAB",
    )
    _close(client_for, planner, tech, reopened)
    _reopen(client_for, planner, reopened)

    body = client_for(solicitante).get(REMINDER).json()

    assert [item["code"] for item in body["items"]] == [closed.code]
    assert body["total"] == 1


def test_reminder_with_several_pending_is_limited_but_counts_all(
    client_for, solicitante, planner, tech, care_unit, area_ti
):
    for index in range(7):
        incident = create_incident(
            user=solicitante,
            care_unit=care_unit,
            support_area=area_ti,
            description=f"Incidencia ficticia número {index}.",
            equipment_qr_status="qr_readable",
            qr_code=f"QR-{index}",
        )
        _close(client_for, planner, tech, incident)

    body = client_for(solicitante).get(REMINDER).json()

    assert body["show"] is True
    assert body["total"] == 7
    assert len(body["items"]) == 5


def test_reminder_works_for_workers_with_several_capabilities(
    client_for, make_user, planner, tech, care_unit, area_ti
):
    multi = make_user(
        "multi.encuesta",
        Role.PLANIFICADOR,
        Role.PERSONAL_ATENCION,
        plans=("ti",),
        verifies=("ti",),
        assigned=("ti",),
    )
    incident = create_incident(
        user=multi,
        care_unit=care_unit,
        support_area=area_ti,
        description="Incidencia ficticia registrada por quien también planifica.",
        equipment_qr_status="qr_readable",
        qr_code="QR-MULTI",
    )
    _close(client_for, planner, tech, incident)

    assert client_for(multi).get(REMINDER).json()["show"] is True


@pytest.mark.parametrize("kind", ["admin", "superuser", "no_roles"])
def test_reminder_is_never_shown_to_non_operational_accounts(client_for, make_user, closed, kind):
    user = {
        "admin": lambda: make_user("admin.rec", Role.ADMINISTRADOR),
        "superuser": lambda: make_user("root.rec", is_superuser=True),
        "no_roles": lambda: make_user("sin.roles.rec"),
    }[kind]()

    assert client_for(user).get(REMINDER).json() == {"show": False, "total": 0, "items": []}


def test_reminder_without_pending_surveys(client_for, solicitante, incident):
    assert client_for(solicitante).get(REMINDER).json() == {"show": False, "total": 0, "items": []}


def test_reminder_requires_authentication_and_csrf(client_for, solicitante, closed):
    assert client_for(None).get(REMINDER).status_code in (401, 403)
    assert client_for(solicitante, enforce_csrf=True).post(REMINDER).status_code == 403


def test_reminder_check_is_passive(client_for, solicitante, closed):
    from django.test import RequestFactory
    from django.urls import resolve

    from apps.accounts.session_policy import is_passive_request

    match = resolve(REMINDER)
    assert is_passive_request(RequestFactory().get(REMINDER), match.func)
