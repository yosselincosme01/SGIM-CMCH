"""
Pruebas de integración de la política de sesión (8 h absolutas, 30 min de inactividad).

Usan un reloj simulado (fixture ``clock``) para avanzar el tiempo sin esperar.
"""

from datetime import datetime

import pytest
from django.conf import settings
from rest_framework import status

from apps.accounts.exceptions import SESSION_EXPIRED_MESSAGE

pytestmark = pytest.mark.django_db

PASSIVE = {"HTTP_X_SGIM_PASSIVE": "1"}
HOUR = 3600


def _assert_session_expired(response, reason):
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.json() == {
        "detail": SESSION_EXPIRED_MESSAGE,
        "code": "session_expired",
        "reason": reason,
    }


@pytest.fixture
def logged_in(clock, user, login, api_client):
    assert login().status_code == status.HTTP_200_OK
    return api_client


# --- Inactividad ----------------------------------------------------------


def test_session_expires_after_thirty_minutes_of_inactivity(clock, logged_in, urls):
    clock.advance(minutes=29, seconds=59)
    assert logged_in.get(urls["me"]).status_code == status.HTTP_200_OK

    clock.advance(minutes=30)
    _assert_session_expired(logged_in.get(urls["me"]), "idle")


def test_expired_session_is_invalidated(clock, logged_in, urls):
    clock.advance(minutes=31)
    response = logged_in.get(urls["me"])

    _assert_session_expired(response, "idle")
    # La cookie se elimina y la sesión deja de existir.
    assert response.cookies[settings.SESSION_COOKIE_NAME].value == ""
    follow_up = logged_in.get(urls["me"])
    assert follow_up.status_code == status.HTTP_401_UNAUTHORIZED
    assert follow_up.json()["code"] == "not_authenticated"


def test_activity_renews_inactivity_window(clock, logged_in, urls):
    for _ in range(4):
        clock.advance(minutes=25)
        assert logged_in.get(urls["me"]).status_code == status.HTTP_200_OK


# --- Duración absoluta ----------------------------------------------------


def test_session_expires_after_eight_hours_despite_activity(clock, logged_in, urls):
    # Actividad cada 20 minutos: nunca vence por inactividad.
    for _ in range(23):  # 23 × 20 min = 7 h 40 min
        clock.advance(minutes=20)
        assert logged_in.get(urls["me"]).status_code == status.HTTP_200_OK

    clock.advance(minutes=19, seconds=59)  # 7 h 59 min 59 s
    assert logged_in.get(urls["me"]).status_code == status.HTTP_200_OK

    clock.advance(seconds=1)  # 8 h exactas
    _assert_session_expired(logged_in.get(urls["me"]), "absolute")


def test_activity_does_not_extend_absolute_limit(clock, logged_in, urls):
    absolute_end = logged_in.get(urls["session"]).json()["absolute_expires_at"]

    for _ in range(5):
        clock.advance(minutes=20)
        assert logged_in.get(urls["me"]).status_code == status.HTTP_200_OK

    body = logged_in.get(urls["session"]).json()
    assert body["absolute_expires_at"] == absolute_end
    assert body["idle_expires_at"] != absolute_end


# --- Peticiones pasivas (polling) -----------------------------------------


def test_session_status_polling_does_not_extend_inactivity(clock, logged_in, urls):
    for _ in range(2):
        clock.advance(minutes=14)
        assert logged_in.get(urls["session"]).status_code == status.HTTP_200_OK

    clock.advance(minutes=2)  # 30 min desde la última actividad válida (el login)
    _assert_session_expired(logged_in.get(urls["session"]), "idle")


def test_passive_header_does_not_extend_inactivity(clock, logged_in, urls):
    clock.advance(minutes=20)
    assert logged_in.get(urls["me"], **PASSIVE).status_code == status.HTTP_200_OK

    clock.advance(minutes=10)
    _assert_session_expired(logged_in.get(urls["me"]), "idle")


def test_failed_requests_do_not_count_as_activity(clock, logged_in, urls):
    clock.advance(minutes=20)
    assert logged_in.post(urls["me"]).status_code == status.HTTP_405_METHOD_NOT_ALLOWED
    assert logged_in.get("/api/v1/no-existe/").status_code == status.HTTP_404_NOT_FOUND

    clock.advance(minutes=10)
    _assert_session_expired(logged_in.get(urls["me"]), "idle")


# --- Protección de endpoints tras la expiración --------------------------


@pytest.mark.parametrize(
    ("method", "name"),
    [("get", "me"), ("get", "session"), ("post", "logout")],
)
def test_protected_endpoints_reject_expired_session(clock, logged_in, urls, method, name):
    clock.advance(minutes=30)

    _assert_session_expired(getattr(logged_in, method)(urls[name]), "idle")


def test_public_endpoints_keep_working_with_expired_session(clock, logged_in, urls):
    clock.advance(hours=8)

    assert logged_in.get("/api/v1/health/").status_code == status.HTTP_200_OK
    assert logged_in.get(urls["csrf"]).status_code == status.HTTP_204_NO_CONTENT


# --- Nuevo inicio de sesión tras la expiración ----------------------------


def test_can_log_in_again_after_expiry(clock, logged_in, urls, login):
    clock.advance(hours=8)
    _assert_session_expired(logged_in.get(urls["me"]), "absolute")

    assert login().status_code == status.HTTP_200_OK
    assert logged_in.get(urls["me"]).status_code == status.HTTP_200_OK


def test_login_over_expired_session_starts_new_absolute_window(clock, logged_in, urls, login):
    clock.advance(hours=8, minutes=5)
    # El login se hace con la cookie de la sesión vencida todavía presente.
    assert login().status_code == status.HTTP_200_OK

    body = logged_in.get(urls["session"]).json()
    absolute_end = datetime.fromisoformat(body["absolute_expires_at"]).timestamp()
    assert absolute_end == pytest.approx(clock.current + 8 * HOUR, abs=1)


# --- Estado de la sesión para el frontend ---------------------------------


def test_session_status_exposes_only_timing_information(clock, logged_in, urls):
    body = logged_in.get(urls["session"]).json()

    assert set(body) == {
        "server_time",
        "expires_at",
        "expires_in",
        "absolute_expires_at",
        "idle_expires_at",
        "absolute_timeout",
        "idle_timeout",
    }
    assert body["absolute_timeout"] == 8 * HOUR
    assert body["idle_timeout"] == 30 * 60
    assert body["expires_in"] == 30 * 60
    assert body["expires_at"] == body["idle_expires_at"]
    session_key = logged_in.cookies[settings.SESSION_COOKIE_NAME].value
    assert session_key not in str(body)


def test_session_status_reports_absolute_end_near_the_limit(clock, logged_in, urls):
    for _ in range(23):
        clock.advance(minutes=20)
        logged_in.get(urls["me"])
    clock.advance(minutes=10)  # 7 h 50 min: faltan 10 min de límite absoluto

    body = logged_in.get(urls["session"]).json()

    assert body["expires_at"] == body["absolute_expires_at"]
    assert body["expires_in"] == 10 * 60


def test_session_cookie_expiry_is_pinned_to_absolute_end(logged_in):
    cookie = logged_in.cookies[settings.SESSION_COOKIE_NAME]

    assert 0 < int(cookie["max-age"]) <= 8 * HOUR


def test_session_status_requires_authentication(api_client, urls):
    response = api_client.get(urls["session"])

    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert response.json()["code"] == "not_authenticated"
