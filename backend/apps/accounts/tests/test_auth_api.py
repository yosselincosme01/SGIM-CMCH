"""
Pruebas de los endpoints /api/v1/auth/.

Las pruebas sin ``django_db`` no tocan la base de datos (comprobación CSRF,
validación, límite de intentos y acceso anónimo).
"""

import pytest
from django.conf import settings
from django.contrib.auth.models import Group
from rest_framework import status

from apps.accounts.roles import Role
from apps.accounts.serializers import INVALID_CREDENTIALS

from .conftest import TEST_PASSWORD


def _login(client, urls, username="usuario.prueba", password=TEST_PASSWORD, **extra):
    return client.post(urls["login"], {"username": username, "password": password}, **extra)


def _csrf_headers(client, urls) -> dict[str, str]:
    client.get(urls["csrf"])
    return {"HTTP_X_CSRFTOKEN": client.cookies[settings.CSRF_COOKIE_NAME].value}


# --- Rutas ----------------------------------------------------------------


def test_auth_urls_are_versioned(urls):
    assert urls == {
        "csrf": "/api/v1/auth/csrf/",
        "login": "/api/v1/auth/login/",
        "logout": "/api/v1/auth/logout/",
        "me": "/api/v1/auth/me/",
        "session": "/api/v1/auth/session/",
    }


# --- CSRF -----------------------------------------------------------------


def test_csrf_endpoint_sets_readable_cookie(api_client, urls):
    response = api_client.get(urls["csrf"])

    assert response.status_code == status.HTTP_204_NO_CONTENT
    cookie = response.cookies[settings.CSRF_COOKIE_NAME]
    assert cookie.value
    assert not cookie["httponly"]  # el frontend debe poder leerla


def test_login_without_csrf_token_is_rejected(csrf_client, urls):
    response = _login(csrf_client, urls)

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert "CSRF" in response.json()["detail"]


@pytest.mark.django_db
def test_login_with_csrf_token_succeeds(csrf_client, urls, user):
    response = _login(csrf_client, urls, **_csrf_headers(csrf_client, urls))

    assert response.status_code == status.HTTP_200_OK


@pytest.mark.django_db
def test_logout_without_csrf_token_is_rejected(csrf_client, urls, user):
    _login(csrf_client, urls, **_csrf_headers(csrf_client, urls))
    # Tras el login Django rota el token CSRF: sin cabecera, debe fallar.
    response = csrf_client.post(urls["logout"])

    assert response.status_code == status.HTTP_403_FORBIDDEN


# --- Login ----------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [{}, {"username": "usuario.prueba"}, {"password": "x"}, {"username": "", "password": ""}],
)
def test_login_requires_username_and_password(api_client, urls, payload):
    response = api_client.post(urls["login"], payload)

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_login_only_accepts_post(api_client, urls):
    assert api_client.get(urls["login"]).status_code == status.HTTP_405_METHOD_NOT_ALLOWED


def test_login_is_throttled(api_client, urls):
    """Tras 5 intentos por minuto, responde 429 (los intentos inválidos también cuentan)."""
    for _ in range(5):
        assert api_client.post(urls["login"], {}).status_code == status.HTTP_400_BAD_REQUEST

    response = api_client.post(urls["login"], {})

    assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.django_db
def test_login_success_returns_current_user(api_client, urls, make_user):
    make_user(roles=[Role.SOLICITANTE], first_name="Ana", last_name="Prueba")

    response = _login(api_client, urls)

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["username"] == "usuario.prueba"
    assert body["full_name"] == "Ana Prueba"
    assert body["roles"] == ["solicitante"]
    assert "password" not in body
    assert settings.SESSION_COOKIE_NAME in response.cookies


@pytest.mark.django_db
def test_session_cookie_is_httponly(api_client, urls, user):
    response = _login(api_client, urls)

    assert response.cookies[settings.SESSION_COOKIE_NAME]["httponly"]


@pytest.mark.django_db
def test_login_rotates_session_key(api_client, urls, user):
    """Previene la fijación de sesión."""
    session = api_client.session
    session["previo"] = True
    session.save()
    key_before = session.session_key
    api_client.cookies[settings.SESSION_COOKIE_NAME] = key_before

    _login(api_client, urls)

    assert api_client.cookies[settings.SESSION_COOKIE_NAME].value != key_before


@pytest.mark.django_db
@pytest.mark.parametrize(
    ("username", "password"),
    [("usuario.prueba", "contraseña-incorrecta"), ("no.existe", TEST_PASSWORD)],
)
def test_invalid_credentials_return_generic_error(api_client, urls, user, username, password):
    response = _login(api_client, urls, username=username, password=password)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json() == {"non_field_errors": [INVALID_CREDENTIALS]}
    assert settings.SESSION_COOKIE_NAME not in response.cookies


@pytest.mark.django_db
def test_inactive_user_cannot_login(api_client, urls, make_user):
    make_user(is_active=False)

    response = _login(api_client, urls)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json() == {"non_field_errors": [INVALID_CREDENTIALS]}


# --- Usuario actual -------------------------------------------------------


def test_me_requires_session(api_client, urls):
    response = api_client.get(urls["me"])

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.has_header("WWW-Authenticate")
    assert response.json()["code"] == "not_authenticated"


@pytest.mark.django_db
def test_me_returns_user_and_roles(api_client, urls, make_user):
    make_user(roles=[Role.PERSONAL_ATENCION, Role.PLANIFICADOR])
    _login(api_client, urls)

    response = api_client.get(urls["me"])

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert set(body) == {
        "id",
        "username",
        "first_name",
        "last_name",
        "full_name",
        "email",
        "roles",
        "capabilities",
        "area_functions",
    }
    assert body["roles"] == ["personal_atencion", "planificador"]
    # Roles sin funciones por área: ninguna capacidad efectiva (ADR 0008).
    assert body["capabilities"] == {"can_plan": False, "can_attend": False, "can_verify": False}


@pytest.mark.django_db
def test_me_reflects_role_changes(api_client, urls, user):
    _login(api_client, urls)
    user.groups.add(Group.objects.get(name=Role.ADMINISTRADOR))

    assert api_client.get(urls["me"]).json()["roles"] == ["administrador"]


# --- Logout ---------------------------------------------------------------


def test_logout_requires_session(api_client, urls):
    response = api_client.post(urls["logout"])

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_logout_ends_session(api_client, urls, user):
    _login(api_client, urls)

    response = api_client.post(urls["logout"])

    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert api_client.get(urls["me"]).status_code == status.HTTP_401_UNAUTHORIZED


# --- Configuración de sesión ---------------------------------------------


def test_session_cookie_settings():
    assert settings.SESSION_COOKIE_HTTPONLY is True
    assert settings.SESSION_COOKIE_SAMESITE == "Lax"
    assert settings.CSRF_COOKIE_SAMESITE == "Lax"
    # SESSION_COOKIE_AGE es solo el tope de almacenamiento, no el límite absoluto.
    assert settings.SESSION_COOKIE_AGE == settings.SGIM_SESSION_ABSOLUTE_TIMEOUT
    # Solo se guarda cuando cambia: las peticiones pasivas no la renuevan.
    assert settings.SESSION_SAVE_EVERY_REQUEST is False
