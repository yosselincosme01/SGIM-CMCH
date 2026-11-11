"""
Atención, cierre técnico, verificación y reapertura (ADR 0006): permisos por rol,
área y asignación; validaciones; transiciones; historial; concurrencia. Datos ficticios.
"""

import threading
from datetime import timedelta

import pytest
from django.core.exceptions import PermissionDenied
from django.db import IntegrityError, connection, transaction
from django.utils import timezone
from rest_framework import status

from apps.accounts.roles import Role
from apps.incidents import attention_services, planning_services
from apps.incidents.attachments import prepare_evidence_image
from apps.incidents.models import (
    Incident,
    IncidentAssignment,
    IncidentAttachment,
    IncidentEvent,
    IncidentIntervention,
    IncidentVerification,
    PriorityLevel,
)
from apps.incidents.services import create_incident

from .conftest import image_bytes, upload

pytestmark = pytest.mark.django_db

ATTENTION_LIST = "/api/v1/incidents/attention/"
PLANNING_LIST = "/api/v1/incidents/planning/"


def detail(code):
    return f"/api/v1/incidents/{code}/"


def future(days=1):
    return (timezone.localtime() + timedelta(days=days)).replace(second=0, microsecond=0)


def _photo(name="evidencia.png"):
    return upload(name, image_bytes("PNG"))


def _intervention_payload(assignment_id, **overrides):
    payload = {
        "assignment": assignment_id,
        "diagnosis": "Fuente de poder dañada (diagnóstico ficticio).",
        "actions_taken": "Se reemplazó la fuente y se probó el equipo.",
        "result": "solved",
        "used_parts": "false",
        "parts_required": "false",
        "photos": [_photo()],
    }
    payload.update(overrides)
    return payload


def _post_intervention(client, code, payload):
    return client.post(f"{detail(code)}interventions/", payload, format="multipart")


def _current(incident):
    return incident.assignments.get(is_current=True)


@pytest.fixture
def planner(make_user):
    # Planifica y verifica (como los Planificadores existentes tras la migración 0007).
    return make_user("plan.prueba", Role.PLANIFICADOR, plans=("ti",), verifies=("ti",))


@pytest.fixture
def tech(make_user):
    return make_user("tec.prueba", Role.PERSONAL_ATENCION, assigned=("ti",))


@pytest.fixture
def tech2(make_user):
    return make_user("tec.dos", Role.PERSONAL_ATENCION, assigned=("ti",))


@pytest.fixture
def incident(solicitante, care_unit, area_ti):
    return create_incident(
        user=solicitante,
        care_unit=care_unit,
        support_area=area_ti,
        description="La impresora de admisión no imprime (dato ficticio).",
        equipment_qr_status="qr_readable",
        qr_code="QR-FICTICIO-ATN",
    )


def _schedule(client, code, technician, **extra):
    payload = {
        "priority": "alta",
        "technician": technician.username,
        "scheduled_at": future().isoformat(),
        **extra,
    }
    response = client.post(f"{detail(code)}planning/", payload, format="json")
    assert response.status_code == 200, response.json()
    return response


@pytest.fixture
def assigned(client_for, planner, tech, incident):
    _schedule(client_for(planner), incident.code, tech)
    incident.refresh_from_db()
    return incident


def _intervene(client_for, user, incident, **overrides):
    payload = _intervention_payload(_current(incident).pk, **overrides)
    return _post_intervention(client_for(user), incident.code, payload)


@pytest.fixture
def closed(client_for, tech, assigned):
    response = _intervene(client_for, tech, assigned)
    assert response.status_code == 201, response.json()
    assigned.refresh_from_db()
    return assigned


# --- Bandeja del Personal de Atención ------------------------------------------------


def test_inbox_lists_only_my_current_assignments(
    client_for, planner, tech, tech2, assigned, solicitante, care_unit, area_ti
):
    other = create_incident(
        user=solicitante,
        care_unit=care_unit,
        support_area=area_ti,
        description="Otra incidencia ficticia del área.",
        equipment_qr_status="qr_readable",
        qr_code="QR-OTRA",
    )
    _schedule(client_for(planner), other.code, tech2)

    mine = client_for(tech).get(ATTENTION_LIST).json()
    theirs = client_for(tech2).get(ATTENTION_LIST).json()

    assert [item["code"] for item in mine["results"]] == [assigned.code]
    assert [item["code"] for item in theirs["results"]] == [other.code]


@pytest.mark.parametrize("who", ["solicitante", "planner", "anon"])
def test_inbox_requires_attention_role(client_for, solicitante, planner, who):
    user = {"solicitante": solicitante, "planner": planner, "anon": None}[who]
    expected = status.HTTP_401_UNAUTHORIZED if user is None else status.HTTP_403_FORBIDDEN

    assert client_for(user).get(ATTENTION_LIST).status_code == expected


def test_inbox_filters_by_status_and_date(client_for, tech, assigned):
    client = client_for(tech)
    assert client.get(f"{ATTENTION_LIST}?status=cerrada").json()["count"] == 0
    day = future().date().isoformat()
    assert client.get(f"{ATTENTION_LIST}?scheduled_on={day}").json()["count"] == 1
    assert client.get(f"{ATTENTION_LIST}?status=registrada").status_code == 400

    _intervene(client_for, tech, assigned)

    closed_list = client.get(f"{ATTENTION_LIST}?status=cerrada").json()
    assert [item["code"] for item in closed_list["results"]] == [assigned.code]


def test_technician_who_loses_area_authorization_loses_the_inbox(client_for, tech, assigned):
    tech.area_memberships.update(can_be_assigned=False)

    assert client_for(tech).get(ATTENTION_LIST).json()["count"] == 0
    response = _intervene(client_for, tech, assigned)
    assert response.status_code == status.HTTP_404_NOT_FOUND  # ya no ve el ticket


# --- Registro de intervenciones --------------------------------------------------------


def test_in_progress_intervention_keeps_ticket_open_and_pending(
    client_for, planner, tech, assigned
):
    response = _intervene(
        client_for,
        tech,
        assigned,
        result="in_progress",
        unresolved_reason="Falta repuesto, se continuará mañana.",
        observations="Equipo operativo con limitaciones.",
        parts_required="true",
        parts_required_detail="Fuente de poder de 500 W (ficticio).",
    )

    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["status"] == "asignada"
    [intervention] = body["interventions"]
    assert intervention["result"] == "in_progress"
    assert intervention["technician"]["username"] == tech.username
    assert intervention["parts_required_detail"] == "Fuente de poder de 500 W (ficticio)."
    assert len(intervention["photos"]) == 1
    assert body["permissions"]["can_intervene"] is True  # puede seguir atendiendo

    pending = client_for(planner).get(f"{PLANNING_LIST}?queue=pending").json()
    assert [item["code"] for item in pending["results"]] == [assigned.code]
    assert pending["results"][0]["last_result"] == {"code": "in_progress", "label": "En proceso"}


def test_solved_intervention_closes_the_ticket_automatically(client_for, planner, tech, assigned):
    assignment = _current(assigned)

    response = _intervene(client_for, tech, assigned)

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "cerrada"
    assert body["closure"]["closed_by"]["username"] == tech.username
    assert body["closure"]["pending_verification"] is True
    assert body["permissions"]["can_intervene"] is False
    assigned.refresh_from_db()
    assignment.refresh_from_db()
    assert assigned.closing_intervention.result == "solved"
    assert assignment.is_current is False and assignment.ended_at is not None
    closed_event = assigned.events.get(event_type=IncidentEvent.Type.CLOSED)
    assert (closed_event.actor, closed_event.from_status, closed_event.to_status) == (
        tech,
        "asignada",
        "cerrada",
    )
    queue = client_for(planner).get(f"{PLANNING_LIST}?queue=verification").json()
    assert [item["code"] for item in queue["results"]] == [assigned.code]


def test_no_interventions_on_a_closed_ticket(client_for, tech, closed):
    closing = closed.closing_intervention
    payload = _intervention_payload(closing.assignment_id)

    response = _post_intervention(client_for(tech), closed.code, payload)

    assert response.status_code == status.HTTP_409_CONFLICT
    assert closed.interventions.count() == 1


@pytest.mark.parametrize("who", ["tech2", "planner", "solicitante"])
def test_only_the_current_assigned_technician_can_intervene(
    client_for, tech2, planner, solicitante, assigned, who
):
    user = {"tech2": tech2, "planner": planner, "solicitante": solicitante}[who]

    response = _intervene(client_for, user, assigned)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert not IncidentIntervention.objects.exists()


def test_technician_of_another_area_cannot_see_or_intervene(client_for, make_user, assigned):
    outsider = make_user("tec.mant", Role.PERSONAL_ATENCION, assigned=("mantenimiento",))

    assert client_for(outsider).get(detail(assigned.code)).status_code == 404
    assert _intervene(client_for, outsider, assigned).status_code == 404


def test_stale_assignment_is_a_conflict(client_for, tech, assigned):
    response = _post_intervention(
        client_for(tech), assigned.code, _intervention_payload(_current(assigned).pk + 999)
    )

    assert response.status_code == status.HTTP_409_CONFLICT


def test_intervention_requires_csrf(client_for, tech, assigned):
    client = client_for(tech, enforce_csrf=True)

    response = _post_intervention(
        client, assigned.code, _intervention_payload(_current(assigned).pk)
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert not IncidentIntervention.objects.exists()


# --- Validaciones ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"photos": []}, "photos"),
        ({"photos": [_photo(f"f{i}.png") for i in range(6)]}, "photos"),
        ({"diagnosis": "   "}, "diagnosis"),
        ({"actions_taken": ""}, "actions_taken"),
        ({"result": ""}, "result"),
        ({"result": "cerrado"}, "result"),
        ({"used_parts": "true"}, "used_parts_detail"),
        ({"parts_required": "true"}, "parts_required_detail"),
        ({"result": "not_solved"}, "unresolved_reason"),
        ({"result": "in_progress", "unresolved_reason": "corto"}, "unresolved_reason"),
        ({"unresolved_reason": "No corresponde a un caso solucionado."}, "unresolved_reason"),
    ],
)
def test_intervention_validation(client_for, tech, assigned, overrides, field):
    response = _intervene(client_for, tech, assigned, **overrides)

    assert response.status_code == 400, response.json()
    assert field in response.json()
    assert not IncidentIntervention.objects.exists()
    assert not IncidentAttachment.objects.filter(intervention__isnull=False).exists()


def test_boolean_indicators_are_mandatory(client_for, tech, assigned):
    payload = _intervention_payload(_current(assigned).pk)
    del payload["used_parts"]
    del payload["parts_required"]

    response = _post_intervention(client_for(tech), assigned.code, payload)

    assert response.status_code == 400
    assert {"used_parts", "parts_required"} <= set(response.json())


def test_used_parts_are_recorded_and_details_discarded_when_not_used(client_for, tech, assigned):
    response = _intervene(
        client_for,
        tech,
        assigned,
        used_parts="true",
        used_parts_detail="Cable de poder (ficticio).",
        parts_required="false",
        parts_required_detail="Se descarta porque no se requiere.",
    )

    [intervention] = response.json()["interventions"]
    assert intervention["used_parts"] is True
    assert intervention["used_parts_detail"] == "Cable de poder (ficticio)."
    assert intervention["parts_required"] is False
    assert intervention["parts_required_detail"] == ""


def test_photos_go_through_the_evidence_controls(client_for, tech, assigned):
    fake = upload("foto.png", b"no es una imagen", "image/png")

    response = _intervene(client_for, tech, assigned, photos=[fake])

    assert response.status_code == 400
    assert "photos" in response.json()


def test_unauthorized_fields_are_rejected(client_for, tech, assigned):
    response = _intervene(client_for, tech, assigned, technician="otro", status="cerrada")

    assert response.status_code == 400
    assert set(response.json()) == {"technician", "status"}


# --- Pendientes, reprogramación e intervenciones sucesivas ----------------------------


def test_reassignment_after_pending_lets_the_next_technician_continue(
    client_for, planner, tech, tech2, assigned
):
    _intervene(
        client_for,
        tech,
        assigned,
        result="not_solved",
        unresolved_reason="Requiere herramienta especializada.",
    )
    first_assignment = _current(assigned)
    _schedule(
        client_for(planner),
        assigned.code,
        tech2,
        expected_assignment=first_assignment.pk,
        reason="Se reasigna a quien tiene la herramienta.",
    )
    assigned.refresh_from_db()

    as_tech2 = client_for(tech2).get(detail(assigned.code)).json()
    assert as_tech2["permissions"]["can_intervene"] is True
    assert [i["result"] for i in as_tech2["interventions"]] == ["not_solved"]  # ve el historial
    assert _intervene(client_for, tech, assigned).status_code == 403  # el anterior ya no

    response = _intervene(client_for, tech2, assigned)

    assert response.status_code == 201
    interventions = list(assigned.interventions.order_by("created_at"))
    assert [i.technician for i in interventions] == [tech, tech2]
    assert interventions[0].assignment == first_assignment
    assert interventions[1].assignment != first_assignment
    assert assigned.interventions.count() == 2


def test_pending_queue_drops_the_ticket_after_reassignment(
    client_for, planner, tech, tech2, assigned
):
    _intervene(
        client_for,
        tech,
        assigned,
        result="in_progress",
        unresolved_reason="Pendiente de autorización del área.",
    )
    _schedule(
        client_for(planner),
        assigned.code,
        tech2,
        expected_assignment=_current(assigned).pk,
        reason="Reprogramación por disponibilidad.",
    )

    assert client_for(planner).get(f"{PLANNING_LIST}?queue=pending").json()["count"] == 0


# --- Verificación ------------------------------------------------------------------------


def test_conforming_verification_is_recorded(client_for, planner, closed):
    response = client_for(planner).post(
        f"{detail(closed.code)}verification/", {"result": "conforming"}, format="json"
    )

    assert response.status_code == 200, response.json()
    closure = response.json()["closure"]
    assert closure["pending_verification"] is False
    assert closure["verification"]["result"] == "conforming"
    assert closure["verification"]["verified_by"]["username"] == planner.username
    assert response.json()["status"] == "cerrada"  # sigue cerrada
    assert client_for(planner).get(f"{PLANNING_LIST}?queue=verification").json()["count"] == 0


def test_a_closure_is_verified_only_once(client_for, planner, closed):
    client = client_for(planner)
    client.post(f"{detail(closed.code)}verification/", {"result": "conforming"}, format="json")

    again = client.post(
        f"{detail(closed.code)}verification/",
        {"result": "not_conforming", "observations": "Cambio de opinión."},
        format="json",
    )

    assert again.status_code == status.HTTP_409_CONFLICT
    assert IncidentVerification.objects.get().result == "conforming"  # no se sobrescribe


def test_not_conforming_requires_observations(client_for, planner, closed):
    response = client_for(planner).post(
        f"{detail(closed.code)}verification/", {"result": "not_conforming"}, format="json"
    )

    assert response.status_code == 400
    assert "observations" in response.json()


@pytest.mark.parametrize("who", ["tech", "other_planner", "solicitante"])
def test_only_the_area_planner_can_verify(client_for, make_user, tech, solicitante, closed, who):
    user = {
        "tech": tech,
        "other_planner": make_user("plan.mant", Role.PLANIFICADOR, plans=("mantenimiento",)),
        "solicitante": solicitante,
    }[who]

    response = client_for(user).post(
        f"{detail(closed.code)}verification/", {"result": "conforming"}, format="json"
    )

    assert response.status_code in (403, 404)
    assert not IncidentVerification.objects.exists()


def test_open_tickets_cannot_be_verified(client_for, planner, assigned):
    response = client_for(planner).post(
        f"{detail(assigned.code)}verification/", {"result": "conforming"}, format="json"
    )

    assert response.status_code == status.HTTP_409_CONFLICT


# --- Reapertura -------------------------------------------------------------------------


def _verify(client_for, planner, incident, result, observations=""):
    payload = {"result": result}
    if observations:
        payload["observations"] = observations
    response = client_for(planner).post(
        f"{detail(incident.code)}verification/", payload, format="json"
    )
    assert response.status_code == 200, response.json()


def test_reopen_requires_a_not_conforming_verification(client_for, planner, closed):
    client = client_for(planner)
    unverified = client.post(
        f"{detail(closed.code)}reopen/", {"reason": "Motivo de prueba suficiente."}, format="json"
    )
    _verify(client_for, planner, closed, "conforming")
    conforming = client.post(
        f"{detail(closed.code)}reopen/", {"reason": "Motivo de prueba suficiente."}, format="json"
    )

    assert unverified.status_code == conforming.status_code == status.HTTP_409_CONFLICT


def test_reopen_requires_a_reason(client_for, planner, closed):
    _verify(client_for, planner, closed, "not_conforming", "La impresora sigue fallando.")

    response = client_for(planner).post(
        f"{detail(closed.code)}reopen/", {"reason": "corto"}, format="json"
    )

    assert response.status_code == 400
    assert "reason" in response.json()


def test_full_cycle_with_reopening_keeps_code_and_history(
    client_for, planner, tech, tech2, closed, solicitante
):
    code = closed.code
    first_closure = closed.closing_intervention
    _verify(
        client_for, planner, closed, "not_conforming", "El problema reapareció al día siguiente."
    )

    reopened = client_for(planner).post(
        f"{detail(code)}reopen/", {"reason": "El usuario reporta la misma falla."}, format="json"
    )
    assert reopened.status_code == 200, reopened.json()
    assert reopened.json()["status"] == "reabierta"
    assert reopened.json()["closure"] is None
    assert reopened.json()["permissions"]["can_plan"] is True

    _schedule(client_for(planner), code, tech2)  # nueva atención, otro técnico
    incident = Incident.objects.get(code=code)
    assert incident.status == "asignada"
    response = _intervene(client_for, tech2, incident)
    assert response.status_code == 201
    incident.refresh_from_db()

    assert incident.code == code
    assert incident.status == "cerrada"
    assert incident.closing_intervention != first_closure
    # El primer cierre y su verificación se conservan; el nuevo espera verificación.
    first_closure.refresh_from_db()
    assert first_closure.verification.result == "not_conforming"
    body = response.json()
    assert body["closure"]["pending_verification"] is True
    assert [i["verification"] is not None for i in body["interventions"]] == [True, False]
    assert IncidentAssignment.objects.filter(incident=incident).count() == 2
    types = list(incident.events.values_list("event_type", flat=True))
    assert types == [
        "created",
        "priority_changed",
        "assigned",
        "intervention",
        "closed",
        "verified",
        "reopened",
        "assigned",
        "intervention",
        "closed",
    ]
    reopen_event = incident.events.get(event_type="reopened")
    assert reopen_event.actor == planner
    assert reopen_event.details["reason"] == "El usuario reporta la misma falla."


def test_tech_cannot_reopen(client_for, planner, tech, closed):
    _verify(client_for, planner, closed, "not_conforming", "No quedó conforme el área.")

    response = client_for(tech).post(
        f"{detail(closed.code)}reopen/",
        {"reason": "Intento del técnico de reabrir."},
        format="json",
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN


# --- Privacidad del solicitante ------------------------------------------------------


def test_requester_sees_closure_but_not_technical_details(
    client_for, planner, tech, closed, solicitante
):
    body = client_for(solicitante).get(detail(closed.code)).json()

    assert body["status"] == "cerrada"
    assert body["closed_at"]
    assert "interventions" not in body and "closure" not in body
    assert body["attachments"] == []  # la foto técnica no es evidencia del registro
    assert [e["event_type"] for e in body["events"]] == ["created", "assigned", "closed"]
    assert "Fuente de poder" not in str(body)


def test_technical_photos_are_protected(client_for, planner, tech, closed, solicitante):
    staff_view = client_for(planner).get(detail(closed.code)).json()
    url = staff_view["interventions"][0]["photos"][0]["url"]

    assert client_for(planner).get(url).status_code == 200
    assert client_for(tech).get(url).status_code == 200
    assert client_for(solicitante).get(url).status_code == 404


# --- Integridad, servicios y concurrencia ----------------------------------------------


def test_database_rejects_incoherent_interventions(tech, assigned):
    intervention = attention_services.register_intervention(
        incident=assigned,
        actor=tech,
        expected_assignment_id=_current(assigned).pk,
        photos=[prepare_evidence_image(_photo())],
        diagnosis="Diagnóstico ficticio.",
        actions_taken="Acción ficticia.",
        result="in_progress",
        used_parts=False,
        parts_required=False,
        unresolved_reason="Motivo ficticio suficiente.",
    )

    for changes in (
        {"used_parts": True},
        {"parts_required": True},
        {"result": "solved"},
        {"unresolved_reason": ""},
        {"diagnosis": ""},
    ):
        with pytest.raises(IntegrityError), transaction.atomic():
            IncidentIntervention.objects.filter(pk=intervention.pk).update(**changes)


def test_database_rejects_closed_ticket_without_closure(assigned):
    with pytest.raises(IntegrityError), transaction.atomic():
        Incident.objects.filter(pk=assigned.pk).update(status="cerrada")


def test_services_enforce_permissions_without_the_api(planner, tech2, closed, assigned):
    with pytest.raises(PermissionDenied):
        attention_services.verify_closure(incident=closed, actor=tech2, result="conforming")


def test_failure_rolls_back_the_whole_intervention(tech, assigned, monkeypatch, tmp_path):
    original = IncidentEvent.objects.create

    def fail_on_close(**kwargs):
        if kwargs.get("event_type") == IncidentEvent.Type.CLOSED:
            raise RuntimeError("fallo simulado")
        return original(**kwargs)

    monkeypatch.setattr(IncidentEvent.objects, "create", fail_on_close)

    with pytest.raises(RuntimeError):
        attention_services.register_intervention(
            incident=assigned,
            actor=tech,
            expected_assignment_id=_current(assigned).pk,
            photos=[prepare_evidence_image(_photo())],
            diagnosis="Diagnóstico ficticio.",
            actions_taken="Acción ficticia.",
            result="solved",
            used_parts=False,
            parts_required=False,
        )

    assigned.refresh_from_db()
    assert assigned.status == "asignada"
    assert not IncidentIntervention.objects.exists()
    assert _current(assigned).is_current
    stored = [p for p in (tmp_path / "media").rglob("*") if p.is_file()]
    assert stored == []  # no quedan archivos huérfanos


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.skipif(
    connection.vendor != "postgresql", reason="Concurrencia real solo en PostgreSQL"
)
def test_concurrent_intervention_and_reassignment(make_user, solicitante, care_unit, area_ti):
    planner = make_user("plan.conc", Role.PLANIFICADOR, plans=("ti",))
    tech = make_user("tec.conc", Role.PERSONAL_ATENCION, assigned=("ti",))
    tech2 = make_user("tec.conc2", Role.PERSONAL_ATENCION, assigned=("ti",))
    incident = create_incident(
        user=solicitante,
        care_unit=care_unit,
        support_area=area_ti,
        description="Incidencia ficticia para concurrencia.",
        equipment_qr_status="qr_readable",
        qr_code="QR-CONC",
    )
    level = PriorityLevel.objects.get(code="alta")
    planning_services.schedule_attention(
        incident=incident, actor=planner, priority=level, technician=tech, scheduled_at=future()
    )
    assignment_id = incident.assignments.get(is_current=True).pk
    photo_bytes = image_bytes("PNG")
    results = {}

    def intervene():
        try:
            attention_services.register_intervention(
                incident=incident,
                actor=tech,
                expected_assignment_id=assignment_id,
                photos=[prepare_evidence_image(upload("c.png", photo_bytes))],
                diagnosis="Diagnóstico ficticio.",
                actions_taken="Acción ficticia.",
                result="solved",
                used_parts=False,
                parts_required=False,
            )
            results["intervention"] = "ok"
        except (planning_services.PlanningConflict, PermissionDenied) as exc:
            results["intervention"] = type(exc).__name__
        finally:
            connection.close()

    def reassign():
        try:
            planning_services.schedule_attention(
                incident=incident,
                actor=planner,
                priority=level,
                technician=tech2,
                scheduled_at=future(2),
                reason="Reasignación simultánea de prueba.",
                expected_assignment_id=assignment_id,
            )
            results["reassign"] = "ok"
        except planning_services.PlanningConflict as exc:
            results["reassign"] = type(exc).__name__
        finally:
            connection.close()

    threads = [threading.Thread(target=intervene), threading.Thread(target=reassign)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    # Exactamente una de las dos operaciones gana; la otra recibe un conflicto.
    assert sorted(results.values()) == ["PlanningConflict", "ok"]
    incident.refresh_from_db()
    assert IncidentAssignment.objects.filter(incident=incident, is_current=True).count() <= 1
    if results["intervention"] == "ok":
        assert incident.status == "cerrada"
    else:
        assert incident.status == "asignada"
        assert not IncidentIntervention.objects.filter(incident=incident).exists()
