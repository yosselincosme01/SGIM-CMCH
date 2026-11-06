"""Pruebas del endpoint de salud /api/v1/health/. No requieren base de datos."""

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def health_url() -> str:
    return reverse("v1:core:health")


def test_health_url_is_versioned(health_url):
    assert health_url == "/api/v1/health/"


def test_health_returns_ok(api_client, health_url):
    response = api_client.get(health_url)

    assert response.status_code == status.HTTP_200_OK
    assert response["Content-Type"] == "application/json"
    assert response.json() == {"status": "ok"}


def test_health_is_public(api_client, health_url):
    """No exige autenticación aunque la política por defecto sea IsAuthenticated."""
    response = api_client.get(health_url)

    assert response.status_code != status.HTTP_401_UNAUTHORIZED
    assert response.status_code != status.HTTP_403_FORBIDDEN


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_health_only_allows_safe_methods(api_client, health_url, method):
    response = getattr(api_client, method)(health_url)

    assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


def test_unknown_api_route_returns_404(api_client):
    response = api_client.get("/api/v1/ruta-inexistente/")

    assert response.status_code == status.HTTP_404_NOT_FOUND
