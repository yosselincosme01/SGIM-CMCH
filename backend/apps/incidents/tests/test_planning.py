"""
Planificación y asignación (ADR 0004): permisos por área, prioridad, programación,
reprogramación, historial, concurrencia, CSRF y aislamiento de información.
Solo datos ficticios.
"""

import threading
from datetime import timedelta

import pytest
from django.core.exceptions import PermissionDenied
from django.db import connection
from django.utils import timezone
from rest_framework import status

from apps.accounts.roles import Role
from apps.incidents import planning_services
from apps.incidents.models import (
    Incident,
    IncidentAssignment,
    IncidentEvent,
    PriorityLevel,
    SupportAreaMembership,
)
from apps.incidents.services import create_incident

pytestmark = pytest.mark.django_db

PLANNING_LIST = "/api/v1/incidents/planning/"
PLANNING_OPTIONS = "/api/v1/incidents/planning/options/"


def detail(code):
    return f"/api/v1/incidents/{code}/"


def plan_url(code):
    return f"{detail(code)}planning/"


def priority_url(code):
    return f"{detail(code)}priority/"


def technicians_url(code):
    return f"{detail(code)}technicians/"


def future(days=2, hour=10):
    value = timezone.localtime() + timedelta(days=days)
    return value.replace(hour=hour, minute=0, second=0, microsecond=0)


def _incident(user, care_unit, area, text="Incidencia ficticia de planificación"):
    return create_incident(user=user, care_unit=care_unit, support_area=area, description=text)


def _plan_payload(technician, **extra):
    return {
        "priority": "alta",
        "technician": technician.username,
        "scheduled_at": future().isoformat(),
        **extra,
    }


@pytest.fixture
def planner(make_user):
    """Planificador de TI."""
    return make_user("plan.prueba", Role.PLANIFICADOR, plans=("ti",))


@pytest.fixture
def tech(make_user):
    """Técnico autorizado de TI."""
    return make_user("tec.prueba", Role.PERSONAL_ATENCION, assigned=("ti",))


@pytest.fixture
def tech_mant(make_user):
    """Técnico autorizado de Mantenimiento (otra área)."""
    return make_user("mant.prueba", Role.PERSONAL_ATENCION, assigned=("mantenimiento",))


@pytest.fixture
def ti_incident(solicitante, care_unit, area_ti):
    return _incident(solicitante, care_unit, area_ti)


@pytest.fixture
def planned(client_for, planner, tech, ti_incident):
    """Incidencia de TI ya programada con ``tech``."""
    response = client_for(planner).post(
        plan_url(ti_incident.code), _plan_payload(tech, notes="Llevar repuesto"), format="json"
    )
    assert response.status_code == 200, response.json()
    ti_incident.refresh_from_db()
    return ti_incident


# --- Migraciones y modelo ---------------------------------------------------------


def test_priority_levels_are_provisional_and_without_sla():
    levels = list(PriorityLevel.objects.values_list("code", "order", "is_provisional"))

    assert levels == [
        ("critica", 1, True),
        ("alta", 2, True),
        ("media", 3, True),
        ("baja", 4, True),
    ]
    assert not PriorityLevel.objects.exclude(description="").exists()
    field_names = {field.name for field in PriorityLevel._meta.get_fields()}
    assert not field_names & {"sla", "max_hours", "response_time", "deadline"}


def test_area_functions_are_restrictive_by_default(make_user, area_ti):
    user = make_user("nuevo.prueba", Role.PLANIFICADOR, Role.PERSONAL_ATENCION)
    membership = SupportAreaMembership.objects.create(area=area_ti, user=user)

    assert membership.can_plan is False
    assert membership.can_be_assigned is False


def test_only_one_current_assignment_per_incident(planned, tech):
    from django.db import IntegrityError, transaction

    with pytest.raises(IntegrityError), transaction.atomic():
        IncidentAssignment.objects.create(
            incident=planned, technician=tech, assigned_by=tech, scheduled_at=future()
        )


# --- Bandeja: solo las áreas autorizadas ------------------------------------------------


def test_planner_inbox_shows_only_authorized_areas(
    client_for, planner, solicitante, care_unit, area_ti, area_mantenimiento
):
    ti = _incident(solicitante, care_unit, area_ti)
    _incident(solicitante, care_unit, area_mantenimiento)

    body = client_for(planner).get(PLANNING_LIST).json()

    assert [item["code"] for item in body["results"]] == [ti.code]
    assert body["results"][0]["priority"] is None
    assert body["results"][0]["assignment"] is None


def test_planner_of_one_area_and_technician_of_another(
    client_for, make_user, solicitante, care_unit, area_ti, area_mantenimiento
):
    """Una persona puede planificar en un área y ser técnico en otra."""
    mixed = make_user(
        "mixto.prueba",
        Role.PLANIFICADOR,
        Role.PERSONAL_ATENCION,
        plans=("ti",),
        assigned=("mantenimiento",),
    )
    ti = _incident(solicitante, care_unit, area_ti)
    mant = _incident(solicitante, care_unit, area_mantenimiento)
    client = client_for(mixed)

    inbox = client.get(PLANNING_LIST).json()
    options = client.get(PLANNING_OPTIONS).json()

    assert [item["code"] for item in inbox["results"]] == [ti.code]
    assert [area["code"] for area in options["areas"]] == ["ti"]
    # Ve la incidencia de Mantenimiento como técnico, pero no puede planificarla.
    assert client.get(detail(mant.code)).json()["permissions"] == {"can_plan": False}
    response = client.put(priority_url(mant.code), {"priority": "alta"}, format="json")
    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.parametrize(
    "who",
    ["solicitante", "tecnico", "administrador", "superusuario", "planificador_sin_area"],
)
def test_inbox_is_forbidden_without_planner_function(client_for, make_user, who):
    users = {
        "solicitante": lambda: make_user("sol.x", Role.SOLICITANTE),
        "tecnico": lambda: make_user("tec.x", Role.PERSONAL_ATENCION, assigned=("ti",)),
        "administrador": lambda: make_user("adm.x", Role.ADMINISTRADOR, areas=("ti",)),
        "superusuario": lambda: make_user("root.x", is_superuser=True, plans=("ti",)),
        "planificador_sin_area": lambda: make_user("plan.x", Role.PLANIFICADOR),
    }
    user = users[who]()
    client = client_for(user)

    if who == "planificador_sin_area":
        # Tiene el rol pero ninguna área: bandeja vacía, sin datos de otras áreas.
        assert client.get(PLANNING_LIST).json()["count"] == 0
        assert client.get(PLANNING_OPTIONS).json()["areas"] == []
    else:
        assert client.get(PLANNING_LIST).status_code == status.HTTP_403_FORBIDDEN
        assert client.get(PLANNING_OPTIONS).status_code == status.HTTP_403_FORBIDDEN


def test_inbox_requires_authentication(client_for):
    assert client_for(None).get(PLANNING_LIST).status_code == status.HTTP_401_UNAUTHORIZED


def test_inbox_filters_and_ordering(client_for, planner, tech, solicitante, care_unit, area_ti):
    first = _incident(solicitante, care_unit, area_ti, "Monitor sin señal en admisión")
    second = _incident(solicitante, care_unit, area_ti, "Teclado dañado en caja")
    client = client_for(planner)
    client.post(plan_url(second.code), _plan_payload(tech), format="json")

    def codes(query):
        response = client.get(f"{PLANNING_LIST}?{query}")
        assert response.status_code == 200, response.json()
        return [item["code"] for item in response.json()["results"]]

    assert codes("priority=none") == [first.code]
    assert codes("priority=alta") == [second.code]
    assert codes("status=registrada") == [first.code]
    assert codes("status=asignada") == [second.code]
    assert codes("q=monitor") == [first.code]
    assert codes(f"technician={tech.username}") == [second.code]
    assert codes(f"scheduled_on={future().date().isoformat()}") == [second.code]
    assert codes("area=mantenimiento") == []
    assert codes("ordering=priority") == [first.code, second.code]  # sin prioridad primero
    assert client.get(f"{PLANNING_LIST}?ordering=password").status_code == 400
    assert client.get(f"{PLANNING_LIST}?status=cerrada").status_code == 400


def test_options_counts(client_for, planner, tech, solicitante, care_unit, area_ti):
    _incident(solicitante, care_unit, area_ti)
    other = _incident(solicitante, care_unit, area_ti)
    client = client_for(planner)
    client.put(priority_url(other.code), {"priority": "media"}, format="json")

    body = client.get(PLANNING_OPTIONS).json()

    assert body["counts"] == {"unprioritized": 1, "unassigned": 2, "scheduled_today": 0}
    assert [level["code"] for level in body["priorities"]] == ["critica", "alta", "media", "baja"]
    assert all(level["is_provisional"] for level in body["priorities"])


def test_inbox_query_count_is_bounded(
    client_for, planner, tech, solicitante, care_unit, area_ti, django_assert_max_num_queries
):
    client = client_for(planner)
    for _ in range(5):
        incident = _incident(solicitante, care_unit, area_ti)
        client.post(plan_url(incident.code), _plan_payload(tech), format="json")

    with django_assert_max_num_queries(12):
        response = client.get(PLANNING_LIST)
    assert response.json()["count"] == 5


# --- Técnicos autorizados -------------------------------------------------------------


def test_technicians_lists_only_authorized_staff_of_the_area(
    client_for, make_user, planner, tech, tech_mant, ti_incident
):
    inactive = make_user("inactivo.prueba", Role.PERSONAL_ATENCION, assigned=("ti",))
    inactive.is_active = False
    inactive.save()
    make_user("sin.funcion", Role.PERSONAL_ATENCION, areas=("ti",))
    make_user("sin.rol", Role.SOLICITANTE, assigned=("ti",))

    body = client_for(planner).get(technicians_url(ti_incident.code)).json()

    assert [person["username"] for person in body["results"]] == [tech.username]
    assert body["results"][0]["active_assignments"] == 0
    assert set(body["results"][0]) == {
        "username",
        "full_name",
        "active_assignments",
        "next_scheduled_at",
    }


def test_technicians_endpoint_is_for_the_area_planner_only(
    client_for, make_user, tech, ti_incident
):
    other_planner = make_user("plan.mant", Role.PLANIFICADOR, plans=("mantenimiento",))

    assert client_for(other_planner).get(technicians_url(ti_incident.code)).status_code == 404
    assert client_for(tech).get(technicians_url(ti_incident.code)).status_code == 403


# --- Prioridad -------------------------------------------------------------------------


def test_priority_can_be_set_before_scheduling(client_for, planner, ti_incident):
    response = client_for(planner).put(
        priority_url(ti_incident.code), {"priority": "critica"}, format="json"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["priority"]["code"] == "critica"
    assert body["status"] == "registrada"
    event = ti_incident.events.get(event_type=IncidentEvent.Type.PRIORITY_CHANGED)
    assert event.actor == planner
    assert event.details == {"from": None, "to": {"code": "critica", "name": "Crítica"}}


def test_priority_change_records_previous_and_new_value(client_for, planner, ti_incident):
    client = client_for(planner)
    client.put(priority_url(ti_incident.code), {"priority": "baja"}, format="json")
    client.put(
        priority_url(ti_incident.code),
        {"priority": "alta", "reason": "El equipo es de uso crítico"},
        format="json",
    )

    last = ti_incident.events.filter(event_type=IncidentEvent.Type.PRIORITY_CHANGED).last()
    assert last.details["from"]["code"] == "baja"
    assert last.details["to"]["code"] == "alta"
    assert last.details["reason"] == "El equipo es de uso crítico"


def test_same_or_invalid_priority_is_rejected(client_for, planner, ti_incident):
    client = client_for(planner)
    client.put(priority_url(ti_incident.code), {"priority": "media"}, format="json")
    PriorityLevel.objects.filter(code="baja").update(is_active=False)

    same = client.put(priority_url(ti_incident.code), {"priority": "media"}, format="json")
    inactive = client.put(priority_url(ti_incident.code), {"priority": "baja"}, format="json")
    unknown = client.put(priority_url(ti_incident.code), {"priority": "urgente"}, format="json")

    assert same.status_code == inactive.status_code == unknown.status_code == 400


def test_requester_cannot_change_priority_or_schedule(client_for, solicitante, tech, ti_incident):
    client = client_for(solicitante)

    priority = client.put(priority_url(ti_incident.code), {"priority": "alta"}, format="json")
    schedule = client.post(plan_url(ti_incident.code), _plan_payload(tech), format="json")

    assert priority.status_code == schedule.status_code == status.HTTP_403_FORBIDDEN
    ti_incident.refresh_from_db()
    assert ti_incident.priority is None
    assert ti_incident.status == Incident.Status.REGISTRADA


def test_planner_of_another_area_gets_404(client_for, make_user, tech, ti_incident):
    other = make_user("plan.mant", Role.PLANIFICADOR, plans=("mantenimiento",))
    client = client_for(other)

    assert client.get(detail(ti_incident.code)).status_code == 404
    assert client.put(priority_url(ti_incident.code), {"priority": "alta"}).status_code == 404
    assert client.post(plan_url(ti_incident.code), _plan_payload(tech)).status_code == 404


def test_system_fields_cannot_be_sent(client_for, planner, tech, ti_incident):
    client = client_for(planner)

    priority = client.put(
        priority_url(ti_incident.code), {"priority": "alta", "status": "asignada"}, format="json"
    )
    schedule = client.post(
        plan_url(ti_incident.code),
        _plan_payload(tech, status="cerrada", assigned_by="otro"),
        format="json",
    )

    assert priority.status_code == schedule.status_code == 400
    assert set(schedule.json()) == {"status", "assigned_by"}


def test_planning_requires_csrf(client_for, planner, tech, ti_incident):
    client = client_for(planner, enforce_csrf=True)

    assert client.put(priority_url(ti_incident.code), {"priority": "alta"}).status_code == 403
    assert client.post(plan_url(ti_incident.code), _plan_payload(tech)).status_code == 403
    assert not IncidentEvent.objects.exclude(event_type=IncidentEvent.Type.CREATED).exists()


# --- Programación inicial -----------------------------------------------------------


def test_initial_scheduling_assigns_and_records_history(client_for, planner, tech, ti_incident):
    when = future()
    response = client_for(planner).post(
        plan_url(ti_incident.code),
        _plan_payload(tech, scheduled_at=when.isoformat(), notes="Coordinar con admisión"),
        format="json",
    )

    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["status"] == "asignada"
    assert body["priority"]["code"] == "alta"
    assert body["assignment"]["technician"]["username"] == tech.username
    assert body["assignment"]["notes"] == "Coordinar con admisión"
    assert body["permissions"] == {"can_plan": True}

    assignment = ti_incident.assignments.get()
    assert assignment.is_current and assignment.assigned_by == planner
    assert assignment.scheduled_at == when
    events = list(ti_incident.events.values_list("event_type", "from_status", "to_status"))
    assert events == [
        ("created", "", "registrada"),
        ("priority_changed", "", ""),
        ("assigned", "registrada", "asignada"),
    ]
    assigned = ti_incident.events.get(event_type="assigned")
    assert assigned.actor == planner
    assert assigned.details["technician"] == {
        "username": tech.username,
        "full_name": tech.full_name,
    }


def test_naive_dates_are_interpreted_as_lima_time(client_for, planner, tech, ti_incident):
    """Sin zona horaria, la fecha es hora de Lima (UTC-5), sin depender de TIME_ZONE."""
    response = client_for(planner).post(
        plan_url(ti_incident.code),
        _plan_payload(tech, scheduled_at="2030-01-15T09:30"),
        format="json",
    )

    assert response.status_code == 200, response.json()
    assert response.json()["assignment"]["scheduled_at"] == "2030-01-15T09:30:00-05:00"
    stored = ti_incident.assignments.get().scheduled_at
    assert stored.astimezone(timezone.UTC).isoformat() == "2030-01-15T14:30:00+00:00"


def test_lima_presentation_does_not_depend_on_time_zone_setting(
    client_for, planner, tech, ti_incident, settings
):
    settings.TIME_ZONE = "Asia/Tokyo"
    response = client_for(planner).post(
        plan_url(ti_incident.code),
        _plan_payload(tech, scheduled_at="2030-01-15T09:30"),
        format="json",
    )

    assert response.json()["assignment"]["scheduled_at"] == "2030-01-15T09:30:00-05:00"


def test_initial_schedule_cannot_be_in_the_past(client_for, planner, tech, ti_incident):
    past = (timezone.now() - timedelta(minutes=5)).isoformat()

    response = client_for(planner).post(
        plan_url(ti_incident.code), _plan_payload(tech, scheduled_at=past), format="json"
    )

    assert response.status_code == 400
    assert "pasado" in response.json()["scheduled_at"][0]
    assert not IncidentAssignment.objects.exists()


def test_far_future_dates_are_allowed(client_for, planner, tech, ti_incident):
    """Sin límite arbitrario de días hacia adelante."""
    response = client_for(planner).post(
        plan_url(ti_incident.code),
        _plan_payload(tech, scheduled_at=future(days=400).isoformat()),
        format="json",
    )

    assert response.status_code == 200


@pytest.mark.parametrize("case", ["otra_area", "sin_rol", "sin_funcion", "inactivo", "no_existe"])
def test_only_authorized_technicians_of_the_area_can_be_assigned(
    client_for, make_user, planner, ti_incident, case
):
    candidates = {
        "otra_area": lambda: make_user("c.x", Role.PERSONAL_ATENCION, assigned=("mantenimiento",)),
        "sin_rol": lambda: make_user("c.x", Role.SOLICITANTE, assigned=("ti",)),
        "sin_funcion": lambda: make_user("c.x", Role.PERSONAL_ATENCION, areas=("ti",)),
        "inactivo": lambda: make_user("c.x", Role.PERSONAL_ATENCION, assigned=("ti",)),
        "no_existe": lambda: type("Fantasma", (), {"username": "no.existe"})(),
    }
    candidate = candidates[case]()
    if case == "inactivo":
        candidate.is_active = False
        candidate.save()

    response = client_for(planner).post(
        plan_url(ti_incident.code), _plan_payload(candidate), format="json"
    )

    assert response.status_code == 400
    # Mismo mensaje en todos los casos: no revela si la cuenta existe.
    assert response.json()["technician"] == [planning_services.INVALID_TECHNICIAN]
    ti_incident.refresh_from_db()
    assert ti_incident.status == Incident.Status.REGISTRADA


def test_self_assignment_requires_being_technician_of_the_same_area(
    client_for, make_user, solicitante, care_unit, area_ti
):
    only_planner = make_user("plan.solo", Role.PLANIFICADOR, plans=("ti",))
    other_area_tech = make_user(
        "plan.otra",
        Role.PLANIFICADOR,
        Role.PERSONAL_ATENCION,
        plans=("ti",),
        assigned=("mantenimiento",),
    )
    same_area_tech = make_user(
        "plan.tec", Role.PLANIFICADOR, Role.PERSONAL_ATENCION, plans=("ti",), assigned=("ti",)
    )

    for user, expected in ((only_planner, 400), (other_area_tech, 400), (same_area_tech, 200)):
        incident = _incident(solicitante, care_unit, area_ti)
        response = client_for(user).post(
            plan_url(incident.code), _plan_payload(user), format="json"
        )
        assert response.status_code == expected, (user.username, response.json())


def test_scheduling_twice_without_expected_assignment_is_a_conflict(
    client_for, planner, tech, planned
):
    response = client_for(planner).post(plan_url(planned.code), _plan_payload(tech), format="json")

    assert response.status_code == status.HTTP_409_CONFLICT
    assert planned.assignments.count() == 1


# --- Reprogramación y reasignación ---------------------------------------------------


def _current(incident):
    return incident.assignments.get(is_current=True)


def test_rescheduling_requires_a_reason(client_for, planner, tech, planned):
    response = client_for(planner).post(
        plan_url(planned.code),
        _plan_payload(
            tech,
            scheduled_at=future(days=5).isoformat(),
            expected_assignment=_current(planned).pk,
        ),
        format="json",
    )

    assert response.status_code == 400
    assert "motivo" in response.json()["reason"][0]
    assert planned.assignments.count() == 1


def test_rescheduling_without_changes_is_rejected(client_for, planner, tech, planned):
    current = _current(planned)
    response = client_for(planner).post(
        plan_url(planned.code),
        _plan_payload(
            tech,
            scheduled_at=current.scheduled_at.isoformat(),
            expected_assignment=current.pk,
            reason="Sin cambios reales en la programación",
        ),
        format="json",
    )

    assert response.status_code == 400


def test_reassignment_records_previous_and_new_technician(
    client_for, make_user, planner, tech, planned
):
    other = make_user("otro.tec", Role.PERSONAL_ATENCION, assigned=("ti",))
    previous = _current(planned)

    response = client_for(planner).post(
        plan_url(planned.code),
        _plan_payload(
            other,
            scheduled_at=previous.scheduled_at.isoformat(),
            expected_assignment=previous.pk,
            reason="El técnico inicial está de licencia",
        ),
        format="json",
    )

    assert response.status_code == 200, response.json()
    previous.refresh_from_db()
    assert previous.is_current is False and previous.ended_at is not None
    assert _current(planned).technician == other
    assert _current(planned).reason == "El técnico inicial está de licencia"
    event = planned.events.get(event_type=IncidentEvent.Type.TECHNICIAN_CHANGED)
    assert event.actor == planner
    assert event.details == {
        "from": {"username": tech.username, "full_name": tech.full_name},
        "to": {"username": other.username, "full_name": other.full_name},
        "reason": "El técnico inicial está de licencia",
    }
    assert not planned.events.filter(event_type=IncidentEvent.Type.SCHEDULE_CHANGED).exists()


def test_rescheduling_records_previous_and_new_date(client_for, planner, tech, planned):
    previous = _current(planned)

    response = client_for(planner).post(
        plan_url(planned.code),
        _plan_payload(
            tech,
            scheduled_at="2031-03-10T15:00",
            expected_assignment=previous.pk,
            reason="El área usuaria pidió otra fecha",
        ),
        format="json",
    )

    assert response.status_code == 200, response.json()
    event = planned.events.get(event_type=IncidentEvent.Type.SCHEDULE_CHANGED)
    assert event.details["to"] == "2031-03-10T15:00:00-05:00"
    assert event.details["from"].endswith("-05:00")
    assert event.details["reason"] == "El área usuaria pidió otra fecha"
    assert planned.assignments.count() == 2
    assert planned.assignments.filter(is_current=True).count() == 1


def test_reschedule_and_reassign_together_records_both_changes(
    client_for, make_user, planner, tech, planned
):
    other = make_user("otro.tec", Role.PERSONAL_ATENCION, assigned=("ti",))

    client_for(planner).post(
        plan_url(planned.code),
        _plan_payload(
            other,
            priority="critica",
            scheduled_at=future(days=3).isoformat(),
            expected_assignment=_current(planned).pk,
            reason="Reorganización por urgencia",
        ),
        format="json",
    )

    types = list(planned.events.values_list("event_type", flat=True))
    assert types[-3:] == ["priority_changed", "technician_changed", "schedule_changed"]


def test_rescheduled_date_cannot_be_in_the_past(client_for, planner, tech, planned):
    response = client_for(planner).post(
        plan_url(planned.code),
        _plan_payload(
            tech,
            scheduled_at=(timezone.now() - timedelta(hours=1)).isoformat(),
            expected_assignment=_current(planned).pk,
            reason="Motivo de prueba suficientemente largo",
        ),
        format="json",
    )

    assert response.status_code == 400


def test_stale_expected_assignment_is_a_conflict(client_for, make_user, planner, tech, planned):
    stale = _current(planned).pk
    other = make_user("otro.tec", Role.PERSONAL_ATENCION, assigned=("ti",))
    client = client_for(planner)
    first = client.post(
        plan_url(planned.code),
        _plan_payload(other, expected_assignment=stale, reason="Primer cambio de técnico"),
        format="json",
    )

    second = client.post(
        plan_url(planned.code),
        _plan_payload(tech, expected_assignment=stale, reason="Cambio con datos antiguos"),
        format="json",
    )

    assert first.status_code == 200
    assert second.status_code == status.HTTP_409_CONFLICT
    assert _current(planned).technician == other


# --- Aislamiento de información ------------------------------------------------------


def test_requester_sees_status_and_date_but_not_internal_data(
    client_for, planner, solicitante, tech, planned
):
    body = client_for(solicitante).get(detail(planned.code)).json()

    assert body["status"] == "asignada"
    assert body["scheduled_at"].endswith("-05:00")
    for hidden in ("priority", "assignment", "permissions"):
        assert hidden not in body
    text = str(body)
    assert "Llevar repuesto" not in text  # indicaciones internas
    assert tech.username not in text
    assert [event["event_type"] for event in body["events"]] == ["created", "assigned"]
    assert body["events"][1]["actor"] == "TI"  # no revela quién planificó
    assert "details" not in body["events"][1]


def test_requester_history_hides_internal_changes(
    client_for, make_user, planner, solicitante, tech, planned
):
    other = make_user("otro.tec", Role.PERSONAL_ATENCION, assigned=("ti",))
    client_for(planner).post(
        plan_url(planned.code),
        _plan_payload(
            other,
            priority="critica",
            scheduled_at=future(days=4).isoformat(),
            expected_assignment=_current(planned).pk,
            reason="Motivo interno de la reasignación",
        ),
        format="json",
    )

    body = client_for(solicitante).get(detail(planned.code)).json()

    assert [event["event_type"] for event in body["events"]] == [
        "created",
        "assigned",
        "schedule_changed",
    ]
    assert "Motivo interno" not in str(body)


def test_staff_detail_includes_planning_data(client_for, planner, tech, planned):
    as_planner = client_for(planner).get(detail(planned.code)).json()
    as_tech = client_for(tech).get(detail(planned.code)).json()

    assert as_planner["assignment"]["notes"] == "Llevar repuesto"
    assert as_planner["permissions"] == {"can_plan": True}
    assert as_tech["priority"]["code"] == "alta"
    assert as_tech["permissions"] == {"can_plan": False}


def test_requester_list_does_not_expose_planning(client_for, solicitante, planned):
    item = client_for(solicitante).get("/api/v1/incidents/").json()["results"][0]

    assert item["status"] == "asignada"
    assert "priority" not in item and "assignment" not in item


def test_care_unit_does_not_grant_access(client_for, make_user, solicitante, care_unit, area_ti):
    """La UPS del ticket no determina permisos: solo cuenta el área y la función."""
    planner_mant = make_user("plan.mant", Role.PLANIFICADOR, plans=("mantenimiento",))
    incident = _incident(solicitante, care_unit, area_ti)

    assert client_for(planner_mant).get(detail(incident.code)).status_code == 404


# --- Servicios y concurrencia -------------------------------------------------------


def test_services_check_permissions_even_without_the_api(make_user, tech, ti_incident):
    """Los controles no dependen del frontend ni de la vista: el servicio los repite."""
    outsider = make_user("fuera.prueba", Role.PLANIFICADOR, plans=("mantenimiento",))

    with pytest.raises(PermissionDenied):
        planning_services.set_priority(
            incident=ti_incident, actor=outsider, priority=PriorityLevel.objects.get(code="alta")
        )
    with pytest.raises(PermissionDenied):
        planning_services.schedule_attention(
            incident=ti_incident,
            actor=outsider,
            priority=PriorityLevel.objects.get(code="alta"),
            technician=tech,
            scheduled_at=future(),
        )


def test_failure_rolls_back_the_whole_planning(planner, tech, ti_incident, monkeypatch):
    original = IncidentEvent.objects.create

    def fail_on_assigned(**kwargs):
        if kwargs.get("event_type") == IncidentEvent.Type.ASSIGNED:
            raise RuntimeError("fallo simulado")
        return original(**kwargs)

    monkeypatch.setattr(IncidentEvent.objects, "create", fail_on_assigned)

    with pytest.raises(RuntimeError):
        planning_services.schedule_attention(
            incident=ti_incident,
            actor=planner,
            priority=PriorityLevel.objects.get(code="alta"),
            technician=tech,
            scheduled_at=future(),
        )

    ti_incident.refresh_from_db()
    assert ti_incident.status == Incident.Status.REGISTRADA
    assert ti_incident.priority is None
    assert not IncidentAssignment.objects.exists()
    assert list(ti_incident.events.values_list("event_type", flat=True)) == ["created"]


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
@pytest.mark.skipif(
    connection.vendor != "postgresql", reason="Concurrencia real solo en PostgreSQL"
)
def test_concurrent_scheduling_never_creates_two_current_assignments(
    make_user, solicitante, care_unit, area_ti
):
    planner = make_user("plan.conc", Role.PLANIFICADOR, plans=("ti",))
    tech = make_user("tec.conc", Role.PERSONAL_ATENCION, assigned=("ti",))
    incident = _incident(solicitante, care_unit, area_ti)
    level = PriorityLevel.objects.get(code="alta")
    results = []

    def worker():
        try:
            planning_services.schedule_attention(
                incident=incident,
                actor=planner,
                priority=level,
                technician=tech,
                scheduled_at=future(),
            )
            results.append("ok")
        except planning_services.PlanningConflict:
            results.append("conflict")
        except Exception as exc:  # pragma: no cover - se informa en la aserción
            results.append(repr(exc))
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results) == ["conflict"] * 4 + ["ok"]
    assert IncidentAssignment.objects.filter(incident=incident, is_current=True).count() == 1
