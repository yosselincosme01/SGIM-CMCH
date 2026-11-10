"""
Gestión de cuentas por el Administrador del SGIM: permisos, escalamiento de
privilegios, desactivación, restablecimiento de acceso y auditoría (ADR 0007).
"""

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from rest_framework import status

from apps.accounts.roles import Role, get_roles
from apps.administration.models import AuditLog
from apps.incidents.models import SupportAreaMembership

from .conftest import PASSWORD

pytestmark = pytest.mark.django_db

USERS = "/api/v1/admin/users/"
NEW_PASSWORD = "Otra-Clave-Ficticia-2027"  # noqa: S105 - contraseña ficticia de pruebas


def user_url(user, suffix=""):
    return f"{USERS}{user.pk}/{suffix}"


def _new_user_payload(**overrides):
    payload = {
        "username": "nuevo.prueba",
        "first_name": "Nuevo",
        "last_name": "Prueba",
        "email": "nuevo@example.test",
        "password": NEW_PASSWORD,
        "password_confirm": NEW_PASSWORD,
        "roles": ["planificador", "personal_atencion"],
        "memberships": [
            {"area": "ti", "can_plan": True, "can_be_assigned": False},
            {"area": "mantenimiento", "can_plan": False, "can_be_assigned": True},
        ],
    }
    payload.update(overrides)
    return payload


# --- Quién puede administrar ----------------------------------------------------------


@pytest.mark.parametrize("who", ["planner", "superuser", "staff", "solicitante", "anon"])
def test_only_sgim_administrator_can_manage_accounts(client_for, make_user, who):
    users = {
        "planner": lambda: make_user("plan.x", Role.PLANIFICADOR, plans=("ti",)),
        "superuser": lambda: make_user("root.x", is_superuser=True, is_staff=True),
        "staff": lambda: make_user("staff.x", is_staff=True),
        "solicitante": lambda: make_user("sol.x", Role.SOLICITANTE),
        "anon": lambda: None,
    }
    client = client_for(users[who]())
    expected = status.HTTP_401_UNAUTHORIZED if who == "anon" else status.HTTP_403_FORBIDDEN

    assert client.get(USERS).status_code == expected
    assert client.post(USERS, _new_user_payload(), format="json").status_code == expected
    assert not get_user_model().objects.filter(username="nuevo.prueba").exists()


def test_list_supports_search_filters_and_marks_protected_accounts(
    client_for, admin_user, make_user
):
    make_user("tec.uno", Role.PERSONAL_ATENCION, assigned=("ti",))
    make_user("tec.dos", Role.PERSONAL_ATENCION, assigned=("mantenimiento",), is_active=False)
    make_user("root.prueba", is_superuser=True, is_staff=True)
    client = client_for(admin_user)

    def usernames(query):
        return [u["username"] for u in client.get(f"{USERS}?{query}").json()["results"]]

    assert usernames("q=tec") == ["tec.dos", "tec.uno"]
    assert usernames("role=personal_atencion&active=true") == ["tec.uno"]
    assert usernames("area=mantenimiento") == ["tec.dos"]
    body = client.get(f"{USERS}?q=prueba").json()["results"]
    protected = {u["username"]: u["is_protected"] for u in body}
    assert protected["admin.prueba"] is True and protected["root.prueba"] is True
    assert all("password" not in u for u in body)


# --- Alta -----------------------------------------------------------------------------


def test_admin_creates_an_operational_account(client_for, admin_user):
    response = client_for(admin_user).post(USERS, _new_user_payload(), format="json")

    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["roles"] == ["personal_atencion", "planificador"]
    assert {m["area"]: (m["can_plan"], m["can_be_assigned"]) for m in body["memberships"]} == {
        "ti": (True, False),
        "mantenimiento": (False, True),
    }
    assert "password" not in body
    user = get_user_model().objects.get(username="nuevo.prueba")
    assert user.check_password(NEW_PASSWORD)
    assert not user.is_superuser and not user.is_staff
    log = AuditLog.objects.get(action=AuditLog.Action.USER_CREATED)
    assert log.actor == admin_user and log.target_user == user
    assert NEW_PASSWORD not in str(log.details)


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"roles": ["administrador"]}, "roles"),
        ({"roles": ["planificador", "administrador"]}, "roles"),
        ({"roles": ["root"]}, "roles"),
        ({"is_superuser": True}, "is_superuser"),
        ({"is_staff": True}, "is_staff"),
        ({"groups": [1]}, "groups"),
        ({"password": "123", "password_confirm": "123"}, "password"),
        ({"password_confirm": "Distinta-2027-xyz"}, "password_confirm"),
        ({"username": "ADMIN.PRUEBA"}, "username"),
        ({"roles": ["solicitante"]}, "memberships"),  # funciones sin el rol
        ({"memberships": [{"area": "inventada", "can_plan": True}]}, "memberships"),
        ({"first_name": ""}, "first_name"),
    ],
)
def test_account_creation_rejects_escalation_and_invalid_data(
    client_for, admin_user, overrides, field
):
    response = client_for(admin_user).post(USERS, _new_user_payload(**overrides), format="json")

    assert response.status_code == 400, response.json()
    assert field in response.json()
    assert not get_user_model().objects.filter(username="nuevo.prueba").exists()


# --- Edición, roles y áreas -----------------------------------------------------------


def test_admin_updates_roles_and_area_functions_with_audit(client_for, admin_user, make_user):
    user = make_user("sol.prueba", Role.SOLICITANTE)

    response = client_for(admin_user).patch(
        user_url(user),
        {
            "first_name": "Sofía",
            "roles": ["solicitante", "personal_atencion"],
            "memberships": [{"area": "ti", "can_be_assigned": True}],
        },
        format="json",
    )

    assert response.status_code == 200, response.json()
    user.refresh_from_db()
    assert user.first_name == "Sofía"
    assert get_roles(user) == ["personal_atencion", "solicitante"]
    assert SupportAreaMembership.objects.get(user=user).can_be_assigned is True
    actions = set(AuditLog.objects.filter(target_user=user).values_list("action", flat=True))
    assert actions == {"user_updated", "roles_changed", "memberships_changed"}
    roles_log = AuditLog.objects.get(target_user=user, action="roles_changed")
    assert roles_log.details["changes"] == {
        "from": ["solicitante"],
        "to": ["personal_atencion", "solicitante"],
    }


def test_removing_a_role_removes_its_area_functions(client_for, admin_user, make_user):
    user = make_user("plan.prueba", Role.PLANIFICADOR, Role.SOLICITANTE, plans=("ti",))

    client_for(admin_user).patch(user_url(user), {"roles": ["solicitante"]}, format="json")

    assert not SupportAreaMembership.objects.filter(user=user).exists()


@pytest.mark.parametrize("target", ["other_admin", "superuser", "staff", "self"])
def test_admin_cannot_modify_protected_accounts_or_itself(
    client_for, admin_user, make_user, target
):
    user = {
        "other_admin": lambda: make_user("admin.dos", Role.ADMINISTRADOR),
        "superuser": lambda: make_user("root.prueba", is_superuser=True, is_staff=True),
        "staff": lambda: make_user("staff.prueba", is_staff=True),
        "self": lambda: admin_user,
    }[target]()
    client = client_for(admin_user)

    responses = [
        client.patch(user_url(user), {"first_name": "Cambio"}, format="json"),
        client.post(user_url(user, "activation/"), {"active": False}, format="json"),
        client.post(
            user_url(user, "password/"),
            {"password": NEW_PASSWORD, "password_confirm": NEW_PASSWORD},
            format="json",
        ),
    ]

    assert all(r.status_code == status.HTTP_403_FORBIDDEN for r in responses)
    user.refresh_from_db()
    assert user.first_name != "Cambio" and user.is_active
    assert user.check_password(PASSWORD)


@pytest.mark.parametrize(
    "payload",
    [
        {"is_superuser": True},
        {"is_staff": True},
        {"username": "otro"},
        {"password": NEW_PASSWORD},
        {"roles": ["administrador"]},
        {"roles": ["solicitante"], "groups": ["administrador"]},
    ],
)
def test_privilege_escalation_through_direct_requests_is_rejected(
    client_for, admin_user, make_user, payload
):
    user = make_user("sol.prueba", Role.SOLICITANTE)

    response = client_for(admin_user).patch(user_url(user), payload, format="json")

    assert response.status_code == 400
    user.refresh_from_db()
    assert not user.is_superuser and not user.is_staff
    assert get_roles(user) == ["solicitante"]
    assert user.username == "sol.prueba"


def test_admin_management_requires_csrf(client_for, admin_user, make_user):
    user = make_user("sol.prueba", Role.SOLICITANTE)
    client = client_for(admin_user, enforce_csrf=True)

    assert client.post(USERS, _new_user_payload(), format="json").status_code == 403
    assert client.patch(user_url(user), {"first_name": "X"}, format="json").status_code == 403


# --- Asignaciones vigentes y desactivación ----------------------------------------------


def test_cannot_leave_open_assignments_without_follow_up(client_for, admin_user, builder):
    incident = builder.assigned("ti")
    tech = builder.techs["ti"]
    client = client_for(admin_user)

    without_role = client.patch(user_url(tech), {"roles": []}, format="json")
    without_area = client.patch(user_url(tech), {"memberships": []}, format="json")
    deactivate = client.post(user_url(tech, "activation/"), {"active": False}, format="json")

    assert without_role.status_code == without_area.status_code == deactivate.status_code == 409
    tech.refresh_from_db()
    assert tech.is_active and get_roles(tech) == ["personal_atencion"]

    builder.intervene(incident)  # al cerrar, la asignación termina
    after = client.post(user_url(tech, "activation/"), {"active": False}, format="json")
    assert after.status_code == 200


def test_deactivation_blocks_access_and_keeps_history(client_for, admin_user, builder):
    incident = builder.intervene(builder.assigned("ti"))
    tech = builder.techs["ti"]
    tech_client = client_for(tech)
    assert tech_client.get("/api/v1/auth/me/").status_code == 200

    response = client_for(admin_user).post(
        user_url(tech, "activation/"), {"active": False}, format="json"
    )

    assert response.status_code == 200 and response.json()["is_active"] is False
    assert tech_client.get("/api/v1/auth/me/").status_code == 401  # sesión ya no válida
    login = client_for(None).post(
        "/api/v1/auth/login/", {"username": tech.username, "password": PASSWORD}, format="json"
    )
    assert login.status_code == 400
    assert incident.interventions.filter(technician=tech).exists()  # historial intacto
    assert AuditLog.objects.filter(action="user_deactivated", target_user=tech).exists()

    reactivate = client_for(admin_user).post(
        user_url(tech, "activation/"), {"active": True}, format="json"
    )
    assert reactivate.status_code == 200


# --- Restablecimiento de acceso -------------------------------------------------------


def test_password_reset_invalidates_sessions_and_is_audited(client_for, admin_user, make_user):
    user = make_user("sol.prueba", Role.SOLICITANTE)
    user_client = client_for(user)

    response = client_for(admin_user).post(
        user_url(user, "password/"),
        {"password": NEW_PASSWORD, "password_confirm": NEW_PASSWORD},
        format="json",
    )

    assert response.status_code == 204
    assert response.content == b""
    user.refresh_from_db()
    assert user.check_password(NEW_PASSWORD) and not user.check_password(PASSWORD)
    assert user_client.get("/api/v1/auth/me/").status_code == 401
    log = AuditLog.objects.get(action="password_reset")
    assert log.target_user == user and NEW_PASSWORD not in str(log.details)


def test_password_reset_applies_django_validators(client_for, admin_user, make_user):
    user = make_user("sol.prueba", Role.SOLICITANTE)

    response = client_for(admin_user).post(
        user_url(user, "password/"),
        {"password": "12345678", "password_confirm": "12345678"},
        format="json",
    )

    assert response.status_code == 400
    assert "password" in response.json()


# --- Auditoría --------------------------------------------------------------------------


def test_audit_log_is_admin_only_and_never_contains_passwords(client_for, admin_user, make_user):
    client_for(admin_user).post(USERS, _new_user_payload(), format="json")
    planner = make_user("plan.x", Role.PLANIFICADOR, plans=("ti",))

    body = client_for(admin_user).get("/api/v1/admin/audit/").json()

    assert body["results"][0]["action"] == "user_created"
    assert body["results"][0]["actor"] == "admin.prueba"
    assert NEW_PASSWORD not in str(body)
    assert client_for(planner).get("/api/v1/admin/audit/").status_code == 403


# --- Procedimiento técnico de TI --------------------------------------------------------


def test_admin_creation_command(monkeypatch):
    answers = iter([NEW_PASSWORD, NEW_PASSWORD])
    monkeypatch.setattr(
        "apps.administration.management.commands.create_sgim_admin.getpass",
        lambda prompt: next(answers),
    )

    call_command(
        "create_sgim_admin",
        "--username=ti.admin",
        "--first-name=Admin",
        "--last-name=Ficticio",
        stdout=StringIO(),
    )

    user = get_user_model().objects.get(username="ti.admin")
    assert get_roles(user) == ["administrador"]
    assert not user.is_superuser and not user.is_staff
    log = AuditLog.objects.get(action="admin_created")
    assert log.actor is None and log.target_user == user


@pytest.mark.parametrize("problem", ["exists", "mismatch", "weak"])
def test_admin_creation_command_refuses_unsafe_cases(monkeypatch, make_user, problem):
    make_user("ti.admin", Role.SOLICITANTE)
    username = "ti.admin" if problem == "exists" else "otro.admin"
    answers = {
        "exists": [NEW_PASSWORD, NEW_PASSWORD],
        "mismatch": [NEW_PASSWORD, "otra-cosa-2027"],
        "weak": ["12345678", "12345678"],
    }[problem]
    it = iter(answers)
    monkeypatch.setattr(
        "apps.administration.management.commands.create_sgim_admin.getpass",
        lambda prompt: next(it),
    )

    with pytest.raises(CommandError):
        call_command(
            "create_sgim_admin",
            f"--username={username}",
            "--first-name=A",
            "--last-name=B",
            stdout=StringIO(),
        )
    assert get_roles(get_user_model().objects.get(username="ti.admin")) == ["solicitante"]


# --- Funciones independientes por área (ADR 0008) -------------------------------------


def _functions(user):
    return {
        m.area.code: (m.can_plan, m.can_be_assigned, m.can_verify)
        for m in SupportAreaMembership.objects.filter(user=user).select_related("area")
    }


def test_admin_configures_the_three_functions_independently(client_for, admin_user):
    payload = _new_user_payload(
        memberships=[
            {"area": "ti", "can_plan": True, "can_be_assigned": False, "can_verify": False},
            {"area": "mantenimiento", "can_plan": False, "can_verify": True},
            {"area": "ingenieria_clinica", "can_be_assigned": True},
        ]
    )

    response = client_for(admin_user).post(USERS, payload, format="json")

    assert response.status_code == 201, response.json()
    user = get_user_model().objects.get(username="nuevo.prueba")
    assert _functions(user) == {
        "ti": (True, False, False),
        "mantenimiento": (False, False, True),
        "ingenieria_clinica": (False, True, False),
    }
    shown = {m["area"]: m["can_verify"] for m in response.json()["memberships"]}
    assert shown == {"ti": False, "mantenimiento": True, "ingenieria_clinica": False}
    created = AuditLog.objects.get(target_user=user, action="user_created")
    assert created.details["memberships"]["mantenimiento"]["can_verify"] is True


def test_verify_function_does_not_require_the_planner_role(client_for, admin_user):
    payload = _new_user_payload(
        roles=["solicitante"], memberships=[{"area": "ti", "can_verify": True}]
    )

    response = client_for(admin_user).post(USERS, payload, format="json")

    assert response.status_code == 201, response.json()
    user = get_user_model().objects.get(username="nuevo.prueba")
    assert get_roles(user) == ["solicitante"]
    assert _functions(user) == {"ti": (False, False, True)}


def test_verify_function_requires_an_operational_role(client_for, admin_user):
    payload = _new_user_payload(roles=[], memberships=[{"area": "ti", "can_verify": True}])

    response = client_for(admin_user).post(USERS, payload, format="json")

    assert response.status_code == 400
    assert "memberships" in response.json()
    assert not get_user_model().objects.filter(username="nuevo.prueba").exists()


def test_changing_plan_does_not_change_verify(client_for, admin_user, make_user):
    user = make_user("plan.prueba", Role.PLANIFICADOR, plans=("ti",), verifies=("ti",))
    client = client_for(admin_user)

    response = client.patch(
        user_url(user),
        {"memberships": [{"area": "ti", "can_plan": False, "can_verify": True}]},
        format="json",
    )
    assert response.status_code == 200, response.json()
    assert _functions(user) == {"ti": (False, False, True)}

    client.patch(
        user_url(user),
        {"memberships": [{"area": "ti", "can_plan": True, "can_verify": False}]},
        format="json",
    )
    assert _functions(user) == {"ti": (True, False, False)}
    changes = (
        AuditLog.objects.filter(target_user=user, action="memberships_changed")
        .order_by("pk")
        .last()
    )
    assert changes.details["changes"]["from"]["ti"]["can_verify"] is True
    assert changes.details["changes"]["to"]["ti"]["can_verify"] is False


def test_removing_the_planner_role_keeps_verify(client_for, admin_user, make_user):
    user = make_user(
        "verif.prueba",
        Role.PLANIFICADOR,
        Role.SOLICITANTE,
        plans=("ti",),
        verifies=("ti",),
    )

    client_for(admin_user).patch(user_url(user), {"roles": ["solicitante"]}, format="json")

    assert _functions(user) == {"ti": (False, False, True)}


def test_removing_every_operational_role_removes_verify(client_for, admin_user, make_user):
    user = make_user("verif.prueba", Role.SOLICITANTE, verifies=("ti",))

    client_for(admin_user).patch(user_url(user), {"roles": []}, format="json")

    assert not SupportAreaMembership.objects.filter(user=user).exists()


def test_admin_cannot_grant_itself_functions(client_for, admin_user):
    response = client_for(admin_user).patch(
        user_url(admin_user),
        {"roles": ["planificador"], "memberships": [{"area": "ti", "can_verify": True}]},
        format="json",
    )

    assert response.status_code == 403
    assert not SupportAreaMembership.objects.filter(user=admin_user).exists()
    assert get_roles(admin_user) == ["administrador"]


def test_admin_cannot_grant_the_admin_role_with_verify(client_for, admin_user, make_user):
    user = make_user("plan.prueba", Role.PLANIFICADOR)

    response = client_for(admin_user).patch(
        user_url(user),
        {
            "roles": ["planificador", "administrador"],
            "memberships": [{"area": "ti", "can_verify": True}],
        },
        format="json",
    )

    assert response.status_code == 400
    assert get_roles(user) == ["planificador"]
    assert not SupportAreaMembership.objects.filter(user=user).exists()
