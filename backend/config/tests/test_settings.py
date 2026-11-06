"""Pruebas de la configuración de Django y de la API para el entorno de pruebas."""

from django.conf import settings


def test_uses_test_settings_module():
    assert settings.SETTINGS_MODULE == "config.settings.test"


def test_debug_is_disabled():
    assert settings.DEBUG is False


def test_database_is_isolated_from_development():
    db = settings.DATABASES["default"]

    assert db["ENGINE"] == "django.db.backends.postgresql"
    assert db["NAME"] not in {"sgim_dev", "sgim", "postgres"}
    assert db["TEST"]["NAME"] == db["NAME"]


def test_fast_password_hasher_only_in_tests():
    assert settings.PASSWORD_HASHERS == ["django.contrib.auth.hashers.MD5PasswordHasher"]


def test_rest_framework_is_installed():
    assert "rest_framework" in settings.INSTALLED_APPS
    assert "apps.core" in settings.INSTALLED_APPS


def test_api_requires_authentication_by_default():
    assert settings.REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] == [
        "rest_framework.permissions.IsAuthenticated",
    ]


def test_api_renders_json_only_outside_development():
    assert settings.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] == [
        "rest_framework.renderers.JSONRenderer",
    ]


def test_api_is_paginated():
    assert settings.REST_FRAMEWORK["DEFAULT_PAGINATION_CLASS"].endswith("PageNumberPagination")
    assert settings.REST_FRAMEWORK["PAGE_SIZE"] == 20
