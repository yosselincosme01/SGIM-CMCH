"""Pruebas unitarias de la política de sesión. No usan base de datos."""

import importlib
import sys
from datetime import UTC, datetime

import pytest
from django.conf import settings
from django.contrib.sessions.backends.signed_cookies import SessionStore
from django.core.exceptions import ImproperlyConfigured
from django.test import RequestFactory

from apps.accounts import session_policy as policy
from apps.accounts.session_policy import ExpiryReason

T0 = 1_900_000_000.0  # instante ficticio de inicio de sesión
HOUR = 3600
MINUTE = 60


@pytest.fixture
def session():
    s = SessionStore()
    s[policy.AUTH_SESSION_KEY] = "1"
    policy.start(s, at=T0)
    return s


# --- Valores por defecto seguros y configuración --------------------------


def test_default_limits_are_eight_hours_and_thirty_minutes():
    assert settings.SGIM_SESSION_ABSOLUTE_TIMEOUT == 8 * HOUR
    assert settings.SGIM_SESSION_IDLE_TIMEOUT == 30 * MINUTE


@pytest.mark.parametrize(
    ("absolute", "idle"),
    [("3600", "0"), ("3600", "-1"), ("1800", "3600")],
)
def test_invalid_limits_are_rejected(monkeypatch, absolute, idle):
    monkeypatch.setenv("SGIM_SESSION_ABSOLUTE_TIMEOUT", absolute)
    monkeypatch.setenv("SGIM_SESSION_IDLE_TIMEOUT", idle)
    # monkeypatch restaura los módulos originales al terminar la prueba.
    monkeypatch.delitem(sys.modules, "config.settings.base")
    monkeypatch.delitem(sys.modules, "config.settings.test")

    with pytest.raises(ImproperlyConfigured, match="SGIM_SESSION_IDLE_TIMEOUT"):
        importlib.import_module("config.settings.test")


def test_limits_are_configurable(settings):
    settings.SGIM_SESSION_ABSOLUTE_TIMEOUT = 2 * HOUR
    settings.SGIM_SESSION_IDLE_TIMEOUT = 10 * MINUTE
    s = SessionStore()
    policy.start(s, at=T0)

    assert policy.expiry_reason(s, at=T0 + 10 * MINUTE) == ExpiryReason.IDLE
    policy.touch(s, at=T0 + 9 * MINUTE)
    assert policy.expiry_reason(s, at=T0 + 2 * HOUR) == ExpiryReason.ABSOLUTE


# --- Inicio de sesión -----------------------------------------------------


def test_start_records_both_timestamps(session):
    times = policy.get_times(session)

    assert times.started_at == T0
    assert times.last_activity == T0
    assert times.absolute_expires_at == T0 + 8 * HOUR
    assert times.idle_expires_at == T0 + 30 * MINUTE
    assert times.expires_at == T0 + 30 * MINUTE


def test_start_pins_cookie_expiry_to_absolute_end(session):
    assert session.get_expiry_date() == datetime.fromtimestamp(T0 + 8 * HOUR, tz=UTC)


def test_new_session_is_valid(session):
    assert policy.expiry_reason(session, at=T0) is None


# --- Inactividad ----------------------------------------------------------


def test_expires_after_thirty_minutes_of_inactivity(session):
    assert policy.expiry_reason(session, at=T0 + 30 * MINUTE - 1) is None
    assert policy.expiry_reason(session, at=T0 + 30 * MINUTE) == ExpiryReason.IDLE


def test_activity_renews_inactivity_window(session):
    policy.touch(session, at=T0 + 20 * MINUTE)

    assert policy.expiry_reason(session, at=T0 + 45 * MINUTE) is None
    assert policy.expiry_reason(session, at=T0 + 50 * MINUTE) == ExpiryReason.IDLE


# --- Duración absoluta ----------------------------------------------------


def test_expires_after_eight_hours_even_with_continuous_activity(session):
    t = T0
    while t < T0 + 8 * HOUR - 20 * MINUTE:
        t += 20 * MINUTE
        assert policy.expiry_reason(session, at=t) is None
        policy.touch(session, at=t)

    assert policy.expiry_reason(session, at=T0 + 8 * HOUR - 1) is None
    assert policy.expiry_reason(session, at=T0 + 8 * HOUR) == ExpiryReason.ABSOLUTE


def test_activity_never_extends_absolute_limit(session):
    policy.touch(session, at=T0 + 7 * HOUR + 50 * MINUTE)
    times = policy.get_times(session)

    assert times.started_at == T0
    assert times.absolute_expires_at == T0 + 8 * HOUR
    assert times.expires_at == T0 + 8 * HOUR  # el límite absoluto llega antes
    assert session.get_expiry_date() == datetime.fromtimestamp(T0 + 8 * HOUR, tz=UTC)


def test_absolute_limit_takes_precedence_over_idle(session):
    policy.touch(session, at=T0 + 7 * HOUR + 59 * MINUTE)

    assert policy.expiry_reason(session, at=T0 + 8 * HOUR) == ExpiryReason.ABSOLUTE


# --- Sesiones sin marcas de tiempo ---------------------------------------


@pytest.mark.parametrize(
    "data",
    [
        {},
        {policy.STARTED_AT_KEY: T0},
        {policy.STARTED_AT_KEY: "x", policy.LAST_ACTIVITY_KEY: T0},
    ],
)
def test_session_without_valid_timestamps_is_rejected(data):
    s = SessionStore()
    s.update(data)

    assert policy.expiry_reason(s, at=T0) == ExpiryReason.INVALID


# --- Peticiones pasivas ---------------------------------------------------


@pytest.mark.parametrize(("value", "expected"), [("1", True), ("true", True), ("0", False)])
def test_passive_header(value, expected):
    request = RequestFactory().get("/api/v1/auth/me/", HTTP_X_SGIM_PASSIVE=value)

    assert policy.is_passive_request(request) is expected


def test_request_without_header_is_active():
    assert policy.is_passive_request(RequestFactory().get("/api/v1/auth/me/")) is False


def test_passive_view_attribute():
    from apps.accounts.views import MeView, SessionStatusView

    request = RequestFactory().get("/")

    assert policy.is_passive_request(request, SessionStatusView.as_view()) is True
    assert policy.is_passive_request(request, MeView.as_view()) is False
