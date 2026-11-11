"""
Funciones independientes por área (ADR 0008): planificar (``can_plan``), registrar
atenciones (``can_be_assigned``) y verificar conformidad (``can_verify``); separación
de funciones; funciones básicas de toda cuenta operativa; migración 0007.

Autorización positiva y negativa, por área y con varias funciones a la vez. Datos
ficticios.
"""

from datetime import timedelta

import pytest
from django.core.exceptions import PermissionDenied
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone
from rest_framework import status

from apps.accounts.roles import Role
from apps.incidents import attention_services, selectors
from apps.incidents.models import Incident, IncidentEvent, IncidentVerification
from apps.incidents.services import create_incident

from .conftest import image_bytes, upload

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/incidents/"
OPTIONS_URL = "/api/v1/incidents/options/"
PLANNING_LIST = "/api/v1/incidents/planning/"
PLANNING_OPTIONS = "/api/v1/incidents/planning/options/"


def detail(code):
    return f"{LIST_URL}{code}/"


def future(days=1):
    return (timezone.localtime() + timedelta(days=days)).replace(second=0, microsecond=0)


def _schedule(client, code, technician):
    payload = {
        "priority": "alta",
        "technician": technician.username,
        "scheduled_at": future().isoformat(),
    }
    return client.post(f"{detail(code)}planning/", payload, format="json")


def _solve(client, incident):
    assignment = incident.assignments.get(is_current=True)
    payload = {
        "assignment": assignment.pk,
        "diagnosis": "Cable de red dañado (diagnóstico ficticio).",
        "actions_taken": "Se reemplazó el cable y se probó la conexión.",
        "result": "solved",
        "used_parts": "false",
        "parts_required": "false",
        "photos": [upload("evidencia.png", image_bytes("PNG"))],
    }
    return client.post(f"{detail(incident.code)}interventions/", payload, format="multipart")


def _verify(client, code, result="conforming", observations=""):
    payload = {"result": result}
    if observations:
        payload["observations"] = observations
    return client.post(f"{detail(code)}verification/", payload, format="json")


def _new_incident(user, care_unit, area):
    return create_incident(
        user=user,
        care_unit=care_unit,
        support_area=area,
        description="El monitor de triaje no enciende (dato ficticio).",
        equipment_qr_status="qr_readable",
        qr_code="QR-FICTICIO-FUN",
    )


# --- Personas de prueba (ficticias) -----------------------------------------------


@pytest.fixture
def only_planner(make_user):
    """Planifica en TI, pero no verifica."""
    return make_user("solo.planifica", Role.PLANIFICADOR, plans=("ti",))


@pytest.fixture
def only_verifier(make_user):
    """
    Verifica en TI: ``can_verify=True``, ``can_plan=False`` y **sin** el rol
    Planificador. Su único rol es Solicitante (cuenta operativa).
    """
    return make_user("solo.verifica", Role.SOLICITANTE, verifies=("ti",))


@pytest.fixture
def tech(make_user):
    return make_user("tec.funciones", Role.PERSONAL_ATENCION, assigned=("ti",))


@pytest.fixture
def all_in_one(make_user):
    """Planifica, verifica y atiende en TI (varias funciones a la vez)."""
    return make_user(
        "todo.ti",
        Role.PLANIFICADOR,
        Role.PERSONAL_ATENCION,
        plans=("ti",),
        verifies=("ti",),
        assigned=("ti",),
    )


@pytest.fixture
def incident(solicitante, care_unit, area_ti):
    return _new_incident(solicitante, care_unit, area_ti)


@pytest.fixture
def closed(client_for, only_planner, tech, incident):
    """Cerrada técnicamente por ``tech`` y pendiente de verificación."""
    assert _schedule(client_for(only_planner), incident.code, tech).status_code == 200
    incident.refresh_from_db()
    assert _solve(client_for(tech), incident).status_code == 201
    incident.refresh_from_db()
    assert incident.status == Incident.Status.CERRADA
    return incident


# --- Planificar sin verificar -------------------------------------------------------


def test_planner_without_verify_can_plan_but_not_verify(client_for, only_planner, tech, incident):
    client = client_for(only_planner)

    assert _schedule(client, incident.code, tech).status_code == status.HTTP_200_OK
    incident.refresh_from_db()
    assert _solve(client_for(tech), incident).status_code == status.HTTP_201_CREATED

    body = client.get(detail(incident.code)).json()
    assert body["permissions"]["can_verify"] is False
    assert _verify(client, incident.code).status_code == status.HTTP_403_FORBIDDEN
    assert not IncidentVerification.objects.exists()


def test_planner_without_verify_has_no_verification_queue(client_for, only_planner, closed):
    client = client_for(only_planner)

    assert client.get(PLANNING_LIST, {"queue": "verification"}).json()["count"] == 0
    options = client.get(PLANNING_OPTIONS).json()
    assert options["counts"]["to_verify"] == 0
    assert options["functions"] == [{"area": "ti", "can_plan": True, "can_verify": False}]


def test_service_rejects_verification_without_the_function(only_planner, closed):
    with pytest.raises(PermissionDenied):
        attention_services.verify_closure(incident=closed, actor=only_planner, result="conforming")


# --- Verificar sin planificar -------------------------------------------------------


def test_verifier_without_plan_can_verify(client_for, only_verifier, closed):
    client = client_for(only_verifier)

    body = client.get(detail(closed.code)).json()
    assert body["permissions"]["can_verify"] is True
    assert body["permissions"]["can_plan"] is False

    response = _verify(client, closed.code)

    assert response.status_code == status.HTTP_200_OK
    verification = IncidentVerification.objects.get()
    assert verification.verified_by == only_verifier
    assert verification.result == "conforming"


def test_verifier_without_plan_cannot_plan(client_for, only_verifier, tech, incident):
    client = client_for(only_verifier)

    assert _schedule(client, incident.code, tech).status_code == status.HTTP_403_FORBIDDEN
    assert client.get(f"{detail(incident.code)}technicians/").status_code == 403
    priority = client.put(f"{detail(incident.code)}priority/", {"priority": "alta"}, format="json")
    assert priority.status_code == status.HTTP_403_FORBIDDEN
    assert not incident.assignments.exists()


def test_verifier_inbox_shows_only_closures_of_its_areas(
    client_for, only_verifier, closed, solicitante, care_unit, area_ti
):
    open_one = _new_incident(solicitante, care_unit, area_ti)  # registrada: no es suya
    client = client_for(only_verifier)

    codes = {item["code"] for item in client.get(PLANNING_LIST).json()["results"]}
    queue = client.get(PLANNING_LIST, {"queue": "verification"}).json()
    options = client.get(PLANNING_OPTIONS).json()

    assert codes == {closed.code}
    assert open_one.code not in codes
    assert [item["code"] for item in queue["results"]] == [closed.code]
    assert options["functions"] == [{"area": "ti", "can_plan": False, "can_verify": True}]
    assert options["counts"]["to_verify"] == 1
    assert options["counts"]["unassigned"] == 0  # no ve trabajo de planificación


def test_verifier_cannot_see_open_incidents_of_others_beyond_its_areas(
    client_for, make_user, solicitante, care_unit, area_mantenimiento
):
    verifier = make_user("verif.ti", Role.PLANIFICADOR, verifies=("ti",))
    other = _new_incident(solicitante, care_unit, area_mantenimiento)

    assert client_for(verifier).get(detail(other.code)).status_code == 404


# --- Separación por área --------------------------------------------------------------


def test_verifier_of_another_area_cannot_verify(client_for, make_user, closed):
    verifier = make_user("verif.mant", Role.PLANIFICADOR, verifies=("mantenimiento",))

    response = _verify(client_for(verifier), closed.code)

    assert response.status_code in (403, 404)
    assert not IncidentVerification.objects.exists()


def test_functions_in_different_areas_do_not_mix(client_for, make_user, closed):
    """Planifica en TI y verifica en Mantenimiento: no puede verificar en TI."""
    user = make_user("mixto.prueba", Role.PLANIFICADOR, plans=("ti",), verifies=("mantenimiento",))

    assert _verify(client_for(user), closed.code).status_code == status.HTTP_403_FORBIDDEN
    assert not selectors.can_verify_area(user, closed.support_area)
    assert selectors.can_plan_area(user, closed.support_area)


# --- Separación de funciones ----------------------------------------------------------


def test_executor_cannot_verify_its_own_intervention(client_for, all_in_one, incident):
    client = client_for(all_in_one)
    assert _schedule(client, incident.code, all_in_one).status_code == 200  # se autoasigna
    incident.refresh_from_db()
    assert _solve(client, incident).status_code == 201

    body = client.get(detail(incident.code)).json()
    queue = client.get(PLANNING_LIST, {"queue": "verification"}).json()
    response = _verify(client, incident.code)

    assert body["permissions"]["can_verify"] is False
    assert body["permissions"]["verification_blocked"] == "own_intervention"
    assert queue["count"] == 0
    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert response.json()["detail"] == attention_services.OWN_INTERVENTION
    assert not IncidentVerification.objects.exists()


def test_service_enforces_separation_of_duties(client_for, all_in_one, incident):
    client = client_for(all_in_one)
    _schedule(client, incident.code, all_in_one)
    incident.refresh_from_db()
    _solve(client, incident)
    incident.refresh_from_db()

    with pytest.raises(PermissionDenied):
        attention_services.verify_closure(incident=incident, actor=all_in_one, result="conforming")


def test_another_verifier_can_verify_what_a_colleague_executed(
    client_for, all_in_one, only_verifier, incident
):
    client = client_for(all_in_one)
    _schedule(client, incident.code, all_in_one)
    incident.refresh_from_db()
    _solve(client, incident)

    assert _verify(client_for(only_verifier), incident.code).status_code == 200


def test_after_reopening_the_executor_can_verify_a_closure_by_someone_else(
    client_for, all_in_one, only_verifier, tech, incident
):
    """La regla mira la intervención de cierre vigente, no el historial completo."""
    client = client_for(all_in_one)
    _schedule(client, incident.code, all_in_one)
    incident.refresh_from_db()
    _solve(client, incident)
    verifier = client_for(only_verifier)
    _verify(verifier, incident.code, "not_conforming", "La conexión vuelve a fallar.")
    reopen = verifier.post(
        f"{detail(incident.code)}reopen/", {"reason": "Persiste la falla de red."}, format="json"
    )
    assert reopen.status_code == 200

    assert _schedule(client, incident.code, tech).status_code == 200
    incident.refresh_from_db()
    assert _solve(client_for(tech), incident).status_code == 201

    assert _verify(client, incident.code).status_code == status.HTTP_200_OK
    assert IncidentVerification.objects.count() == 2  # el historial se conserva


# --- Reapertura ------------------------------------------------------------------------


def _not_conforming(client_for, verifier, incident):
    response = _verify(client_for(verifier), incident.code, "not_conforming", "Sigue sin red.")
    assert response.status_code == 200


def test_verifier_without_plan_can_reopen(client_for, only_verifier, closed):
    _not_conforming(client_for, only_verifier, closed)

    response = client_for(only_verifier).post(
        f"{detail(closed.code)}reopen/", {"reason": "La falla continúa en admisión."}, format="json"
    )

    assert response.status_code == status.HTTP_200_OK
    closed.refresh_from_db()
    assert closed.status == Incident.Status.REABIERTA
    assert IncidentEvent.objects.filter(incident=closed, event_type="reopened").exists()


def test_planner_without_verify_can_still_reopen(client_for, only_planner, only_verifier, closed):
    """El flujo actual se conserva: el Planificador reabre y vuelve a programar."""
    _not_conforming(client_for, only_verifier, closed)
    client = client_for(only_planner)

    assert client.get(detail(closed.code)).json()["permissions"]["can_reopen"] is True
    response = client.post(
        f"{detail(closed.code)}reopen/", {"reason": "La falla continúa en admisión."}, format="json"
    )

    assert response.status_code == status.HTTP_200_OK


@pytest.mark.parametrize("who", ["tech", "solicitante", "other_area"])
def test_without_plan_or_verify_nobody_reopens(
    client_for, make_user, only_verifier, tech, solicitante, closed, who
):
    _not_conforming(client_for, only_verifier, closed)
    user = {
        "tech": tech,
        "solicitante": solicitante,
        "other_area": make_user(
            "otra.area", Role.PLANIFICADOR, plans=("mantenimiento",), verifies=("mantenimiento",)
        ),
    }[who]

    response = client_for(user).post(
        f"{detail(closed.code)}reopen/", {"reason": "Intento no autorizado."}, format="json"
    )

    assert response.status_code in (403, 404)
    closed.refresh_from_db()
    assert closed.status == Incident.Status.CERRADA


# --- Sin privilegios implícitos ------------------------------------------------------


@pytest.mark.parametrize("roles", [(), (Role.ADMINISTRADOR,)])
def test_can_verify_on_a_non_operational_account_grants_nothing(
    client_for, make_user, closed, roles
):
    """Sin rol operativo (cuenta sin roles o solo administrativa), la pertenencia no basta."""
    user = make_user("no.operativa", *roles, verifies=("ti",))
    client = client_for(user)

    assert _verify(client, closed.code).status_code in (403, 404)
    assert client.get(PLANNING_LIST).status_code == 403
    assert not selectors.can_verify_area(user, closed.support_area)


# --- Verificador sin rol Planificador: accesos permitidos y denegados ----------------


def test_verifier_without_planner_role_has_no_planner_role(only_verifier):
    assert not only_verifier.groups.filter(name=Role.PLANIFICADOR).exists()
    assert not selectors.planning_areas(only_verifier).exists()


def test_verifier_without_planner_role_uses_the_existing_endpoints(
    client_for, only_verifier, closed
):
    client = client_for(only_verifier)

    options = client.get(PLANNING_OPTIONS)
    inbox = client.get(PLANNING_LIST, {"queue": "verification"})
    body = client.get(detail(closed.code)).json()
    me = client.get("/api/v1/auth/me/").json()

    assert options.status_code == 200
    assert options.json()["functions"] == [{"area": "ti", "can_plan": False, "can_verify": True}]
    assert [item["code"] for item in inbox.json()["results"]] == [closed.code]
    # Ve los datos necesarios para verificar: cierre, intervención y evidencia técnica.
    assert body["closure"] is not None
    assert body["interventions"][0]["diagnosis"]
    photo = body["interventions"][0]["photos"][0]["url"]
    assert client.get(photo).status_code == 200
    assert me["roles"] == ["solicitante"]
    assert me["capabilities"] == {"can_plan": False, "can_attend": False, "can_verify": True}


def test_verifier_without_planner_role_verifies_and_reopens(client_for, only_verifier, closed):
    client = client_for(only_verifier)

    verify = _verify(client, closed.code, "not_conforming", "La conexión sigue fallando.")
    reopen = client.post(
        f"{detail(closed.code)}reopen/", {"reason": "Persiste la falla de red."}, format="json"
    )

    assert verify.status_code == 200
    assert reopen.status_code == 200
    closed.refresh_from_db()
    assert closed.status == Incident.Status.REABIERTA
    assert IncidentVerification.objects.get().verified_by == only_verifier


def test_verifier_without_planner_role_gets_no_extra_privileges(
    client_for, only_verifier, tech, closed, solicitante, care_unit, area_ti
):
    """Verificar no da planificación, atención, indicadores ni administración."""
    open_one = _new_incident(solicitante, care_unit, area_ti)
    client = client_for(only_verifier)

    assert _schedule(client, open_one.code, tech).status_code == 403
    assert client.get(f"{detail(open_one.code)}technicians/").status_code == 403
    assert (
        client.put(f"{detail(open_one.code)}priority/", {"priority": "alta"}, format="json")
    ).status_code == 403
    assert client.get("/api/v1/incidents/attention/").status_code == 403
    assert client.get("/api/v1/reports/dashboard/").status_code == 403
    assert client.get("/api/v1/reports/incidents/export/").status_code == 403
    assert client.get("/api/v1/admin/users/").status_code == 403
    codes = {item["code"] for item in client.get(PLANNING_LIST).json()["results"]}
    assert open_one.code not in codes  # no ve el trabajo de planificación del área


def test_verifier_without_planner_role_is_isolated_by_area(
    client_for, make_user, tech, solicitante, care_unit, area_mantenimiento
):
    verifier = make_user("verif.ti.sol", Role.PERSONAL_ATENCION, verifies=("ti",))
    planner = make_user("plan.mant", Role.PLANIFICADOR, plans=("mantenimiento",))
    tech_mant = make_user("tec.mant", Role.PERSONAL_ATENCION, assigned=("mantenimiento",))
    other = _new_incident(solicitante, care_unit, area_mantenimiento)
    assert _schedule(client_for(planner), other.code, tech_mant).status_code == 200
    other.refresh_from_db()
    assert _solve(client_for(tech_mant), other).status_code == 201

    client = client_for(verifier)

    assert client.get(detail(other.code)).status_code == 404
    assert _verify(client, other.code).status_code in (403, 404)
    assert client.get(PLANNING_LIST, {"queue": "verification"}).json()["count"] == 0
    assert not IncidentVerification.objects.exists()


def test_verifier_without_planner_role_cannot_verify_own_closure(
    client_for, make_user, only_planner, incident
):
    """Técnico que además verifica (sin rol Planificador): no aprueba su propio cierre."""
    worker = make_user("tec.verifica", Role.PERSONAL_ATENCION, assigned=("ti",), verifies=("ti",))
    assert _schedule(client_for(only_planner), incident.code, worker).status_code == 200
    incident.refresh_from_db()
    assert _solve(client_for(worker), incident).status_code == 201

    client = client_for(worker)
    body = client.get(detail(incident.code)).json()

    assert body["permissions"]["verification_blocked"] == "own_intervention"
    assert _verify(client, incident.code).status_code == 403
    assert client.get(PLANNING_LIST, {"queue": "verification"}).json()["count"] == 0


@pytest.mark.parametrize("with_membership", [True, False])
def test_superuser_gets_no_implicit_verification(client_for, make_user, closed, with_membership):
    root = make_user(
        "root.prueba",
        is_superuser=True,
        **({"plans": ("ti",), "verifies": ("ti",), "assigned": ("ti",)} if with_membership else {}),
    )
    client = client_for(root)

    assert _verify(client, closed.code).status_code in (403, 404)
    assert client.get(detail(closed.code)).status_code == 404
    assert client.get(PLANNING_OPTIONS).status_code == 403
    assert client.post(LIST_URL, {}, format="multipart").status_code == 403
    assert not selectors.can_verify_area(root, closed.support_area)


def test_inactive_verifier_is_rejected(only_verifier, closed):
    only_verifier.is_active = False
    only_verifier.save(update_fields=["is_active"])

    assert not selectors.can_verify_area(only_verifier, closed.support_area)
    with pytest.raises(PermissionDenied):
        attention_services.verify_closure(incident=closed, actor=only_verifier, result="conforming")


def test_inactive_area_disables_verification(only_verifier, closed, area_ti):
    area_ti.is_active = False
    area_ti.save(update_fields=["is_active"])

    assert not selectors.can_verify_area(only_verifier, area_ti)


# --- Funciones básicas de los trabajadores ---------------------------------------------


@pytest.mark.parametrize(
    "roles",
    [
        (Role.SOLICITANTE,),
        (Role.PLANIFICADOR,),
        (Role.PERSONAL_ATENCION,),
        (Role.PLANIFICADOR, Role.PERSONAL_ATENCION),
    ],
)
def test_every_operational_worker_registers_and_follows_own_incidents(
    client_for, make_user, valid_payload, roles
):
    worker = make_user("trabajador.prueba", *roles)
    client = client_for(worker)

    created = client.post(LIST_URL, valid_payload, format="multipart")
    assert created.status_code == status.HTTP_201_CREATED, created.json()
    code = created.json()["code"]

    mine = client.get(LIST_URL).json()
    assert [item["code"] for item in mine["results"]] == [code]
    body = client.get(detail(code)).json()
    assert body["status"] == "registrada"
    assert "events" in body  # seguimiento


def test_workers_do_not_see_incidents_of_others(
    client_for, make_user, solicitante, care_unit, area_ti
):
    other = _new_incident(solicitante, care_unit, area_ti)
    worker = make_user("tec.sin.area", Role.PERSONAL_ATENCION)  # sin funciones por área

    client = client_for(worker)

    assert client.get(detail(other.code)).status_code == 404
    assert client.get(LIST_URL).json()["count"] == 0
    assert client.get(LIST_URL, {"scope": "area"}).status_code == 403


@pytest.mark.parametrize("roles", [(), (Role.ADMINISTRADOR,)])
def test_non_operational_accounts_cannot_register(client_for, make_user, valid_payload, roles):
    user = make_user("no.operativa", *roles)

    response = client_for(user).post(LIST_URL, valid_payload, format="multipart")

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert not Incident.objects.exists()


def test_account_without_operational_role_loses_access_to_own_incidents(
    client_for, solicitante, incident
):
    """Al retirarle todos los roles operativos, ya no consulta ni sus propias incidencias."""
    solicitante.groups.clear()
    client = client_for(solicitante)

    assert client.get(LIST_URL).json()["count"] == 0
    assert client.get(detail(incident.code)).status_code == 404


def test_inactive_worker_cannot_register(client_for, make_user, valid_payload):
    worker = make_user("inactivo.prueba", Role.SOLICITANTE)
    client = client_for(worker)
    worker.is_active = False
    worker.save(update_fields=["is_active"])

    response = client.post(LIST_URL, valid_payload, format="multipart")

    assert response.status_code in (401, 403)
    assert not Incident.objects.exists()


# --- Migración 0007: conserva el acceso de verificación ---------------------------------


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_migration_preserves_verification_for_existing_planners():
    before_node = [("incidents", "0006_attention_workflow")]
    after_node = [("incidents", "0007_membership_can_verify")]
    executor = MigrationExecutor(connection)
    executor.migrate(before_node)
    old_apps = executor.loader.project_state(before_node).apps
    user_model = old_apps.get_model("accounts", "User")
    area_model = old_apps.get_model("incidents", "SupportArea")
    membership = old_apps.get_model("incidents", "SupportAreaMembership")
    ti = area_model.objects.get(code="ti")
    planner = user_model.objects.create(username="plan.legado")
    technician = user_model.objects.create(username="tec.legado")
    membership.objects.create(area=ti, user=planner, can_plan=True, can_be_assigned=False)
    membership.objects.create(area=ti, user=technician, can_plan=False, can_be_assigned=True)

    executor = MigrationExecutor(connection)
    executor.migrate(after_node)
    new_apps = executor.loader.project_state(after_node).apps
    migrated = new_apps.get_model("incidents", "SupportAreaMembership").objects

    planner_row = migrated.get(user_id=planner.pk)
    technician_row = migrated.get(user_id=technician.pk)
    assert (planner_row.can_plan, planner_row.can_verify) == (True, True)
    assert (technician_row.can_be_assigned, technician_row.can_verify) == (True, False)

    # Desde aquí son independientes: retirar can_plan no retira can_verify.
    migrated.filter(pk=planner_row.pk).update(can_plan=False)
    assert migrated.get(pk=planner_row.pk).can_verify is True

    executor = MigrationExecutor(connection)
    executor.migrate(before_node)  # reversible
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
