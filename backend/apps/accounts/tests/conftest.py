"""Fixtures de pruebas de autenticación. Solo datos ficticios."""

import time

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts import session_policy

TEST_PASSWORD = "Clave-de-prueba-2026"  # noqa: S105 - contraseña ficticia de pruebas


@pytest.fixture(autouse=True)
def _clear_cache():
    """El límite de intentos usa la caché: se limpia entre pruebas."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def csrf_client() -> APIClient:
    """Cliente que, como un navegador, está sujeto a la comprobación CSRF."""
    return APIClient(enforce_csrf_checks=True)


@pytest.fixture
def urls() -> dict[str, str]:
    names = ("csrf", "login", "logout", "me", "session")
    return {name: reverse(f"v1:accounts:{name}") for name in names}


class Clock:
    """Reloj simulado para la política de sesión. Empieza en la hora real y solo avanza."""

    def __init__(self) -> None:
        self.current = time.time()

    def __call__(self) -> float:
        return self.current

    def advance(self, *, hours: float = 0, minutes: float = 0, seconds: float = 0) -> None:
        self.current += hours * 3600 + minutes * 60 + seconds


@pytest.fixture
def clock(monkeypatch) -> Clock:
    fake = Clock()
    monkeypatch.setattr(session_policy, "now", fake)
    return fake


@pytest.fixture
def make_user(db):
    def _make_user(username="usuario.prueba", roles=(), **extra):
        user = get_user_model().objects.create_user(
            username=username,
            password=TEST_PASSWORD,
            email=extra.pop("email", f"{username}@example.test"),
            **extra,
        )
        for role in roles:
            user.groups.add(Group.objects.get(name=role))
        return user

    return _make_user


@pytest.fixture
def login(api_client, urls):
    """Inicia sesión con el cliente de pruebas y devuelve la respuesta."""

    def _login(username="usuario.prueba", password=TEST_PASSWORD, client=None):
        client = client or api_client
        return client.post(urls["login"], {"username": username, "password": password})

    return _login


@pytest.fixture
def user(make_user):
    return make_user(first_name="Ana", last_name="Prueba")
