"""
Resumen del Inicio (ADR 0010): indicadores y pendientes según capacidades efectivas y
áreas autorizadas, sin duplicados ni datos inventados. Usa el ``builder`` de
incidencias ficticias de estas pruebas. Datos ficticios.
"""

from datetime import timedelta

import pytest

from apps.accounts.roles import Role

pytestmark = pytest.mark.django_db

SUMMARY = "/api/v1/incidents/summary/"


def summary(client_for, user):
    response = client_for(user).get(SUMMARY)
    assert response.status_code == 200
    return response.json()


def codes(body):
    return [item["code"] for item in body["todo"]["items"]]


def test_requires_authentication(client_for):
    assert client_for(None).get(SUMMARY).status_code in (401, 403)


# --- Trabajador con funciones básicas ---------------------------------------------------


def test_requester_sees_own_incidents_by_status_only(client_for, builder):
    builder.registered("ti")
    builder.assigned("mantenimiento")
    builder.intervene(builder.assigned("ti"))

    body = summary(client_for, builder.requester)

    assert body["own"]["total"] == 3
    by_status = {row["key"]: row["total"] for row in body["own"]["by_status"]}
    assert by_status == {"registrada": 1, "asignada": 1, "cerrada": 1, "reabierta": 0}
    assert body["planning"] is None
    assert body["attention"] is None
    assert body["verification"] is None
    assert body["surveys"] == {"pending": 1}  # la cerrada aún no se evaluó (ADR 0012)
    assert body["todo"] == {"total": 0, "items": []}


# --- Planificación ------------------------------------------------------------------------


def test_planner_sees_pending_planning_of_its_areas_only(client_for, make_user, builder):
    planner = make_user("plan.solo", Role.PLANIFICADOR, plans=("ti",))
    new_ti = builder.registered("ti")
    builder.registered("mantenimiento")  # otra área: no cuenta
    in_progress = builder.intervene(builder.assigned("ti"), result="in_progress")

    body = summary(client_for, planner)

    assert body["planning"] == {"to_schedule": 1, "follow_up": 1}
    assert body["verification"] is None
    assert body["own"] == {"total": 0, "by_status": body["own"]["by_status"]}
    actions = {item["code"]: item["action"] for item in body["todo"]["items"]}
    assert actions == {new_ti.code: "plan", in_progress.code: "follow_up"}


# --- Verificación ---------------------------------------------------------------------------


def test_verifier_without_planner_role_sees_pending_verifications(client_for, make_user, builder):
    verifier = make_user("solo.verifica", Role.SOLICITANTE, verifies=("ti",))
    closed = builder.intervene(builder.assigned("ti"))
    builder.verify(builder.intervene(builder.assigned("ti")), "conforming")  # ya verificada
    builder.registered("ti")  # no es trabajo de verificación

    body = summary(client_for, verifier)

    assert body["verification"] == {"pending": 1}
    assert body["planning"] is None
    assert [(i["code"], i["action"], i["date_label"]) for i in body["todo"]["items"]] == [
        (closed.code, "verify", "Cerrada")
    ]


def test_executor_does_not_see_its_own_closure_to_verify(client_for, make_user, builder):
    worker = make_user("tec.verifica", Role.PERSONAL_ATENCION, assigned=("ti",), verifies=("ti",))
    builder.techs["ti"] = worker
    builder.intervene(builder.assigned("ti"))

    body = summary(client_for, worker)

    assert body["verification"] == {"pending": 0}
    assert body["todo"]["total"] == 0


# --- Atención -------------------------------------------------------------------------------


def test_technician_sees_current_assignments_soonest_first(client_for, builder):
    first = builder.assigned("ti")
    second = builder.assigned("ti")
    builder.intervene(builder.assigned("ti"))  # cerrada: ya no está pendiente
    earlier = first.assignments.get(is_current=True).scheduled_at - timedelta(hours=1)
    second.assignments.filter(is_current=True).update(scheduled_at=earlier)

    body = summary(client_for, builder.techs["ti"])

    assert body["attention"] == {"assigned": 2}
    assert codes(body) == [second.code, first.code]
    assert {item["action"] for item in body["todo"]["items"]} == {"attend"}
    assert body["todo"]["items"][0]["date_label"] == "Programada"


# --- Varias capacidades: sin duplicados -------------------------------------------------------


def test_multi_capability_lists_each_incident_once(client_for, make_user, builder):
    multi = make_user(
        "todo.ti",
        Role.PLANIFICADOR,
        Role.PERSONAL_ATENCION,
        plans=("ti",),
        verifies=("ti",),
        assigned=("ti",),
    )
    colleague = builder.techs["ti"]
    # Asignada a la persona y con atención pendiente: es "atender" y también "seguimiento".
    builder.techs["ti"] = multi
    pending = builder.intervene(builder.assigned("ti"), result="not_solved")
    # Cerrada por otra persona: la puede verificar.
    builder.techs["ti"] = colleague
    closed = builder.intervene(builder.assigned("ti"))
    new = builder.registered("ti")

    body = summary(client_for, multi)

    assert body["attention"] == {"assigned": 1}
    assert body["planning"] == {"to_schedule": 1, "follow_up": 1}
    assert body["verification"] == {"pending": 1}
    assert len(codes(body)) == len(set(codes(body))) == body["todo"]["total"] == 3
    actions = {item["code"]: item["action"] for item in body["todo"]["items"]}
    assert actions == {pending.code: "attend", closed.code: "verify", new.code: "plan"}


def test_todo_is_limited_but_reports_the_real_total(client_for, make_user, builder):
    planner = make_user("plan.solo", Role.PLANIFICADOR, plans=("ti",))
    for _ in range(12):
        builder.registered("ti")

    body = summary(client_for, planner)

    assert body["todo"]["total"] == 12
    assert len(body["todo"]["items"]) == 10


# --- Sin capacidades operativas --------------------------------------------------------------


@pytest.mark.parametrize("kind", ["admin", "superuser"])
def test_non_operational_accounts_get_an_empty_summary(client_for, make_user, builder, kind):
    builder.intervene(builder.assigned("ti"))
    user = (
        make_user("admin.solo", Role.ADMINISTRADOR)
        if kind == "admin"
        else make_user("root.solo", is_superuser=True, is_staff=True)
    )

    body = summary(client_for, user)

    assert body["own"] is None
    assert body["surveys"] is None
    assert body["planning"] is None and body["attention"] is None
    assert body["verification"] is None
    assert body["todo"] == {"total": 0, "items": []}
    assert "recent" not in body
