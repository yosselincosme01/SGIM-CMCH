"""La configuración de pruebas debe negarse a usar cualquier base que no sea de pruebas."""

import importlib
import sys

import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import connection

from config.test_safety import (
    UnsafeTestConfiguration,
    validate_environment,
    validate_test_db_name,
)

DEV_LIKE_NAMES = ["sgim_dev", "sgim_app", "sgim", "postgres", "test_sgim_app", "sgim_app_test"]


def _reload_test_settings(monkeypatch):
    # Se recargan base y test para que lean el entorno modificado.
    # monkeypatch restaura los módulos originales al terminar la prueba.
    monkeypatch.delitem(sys.modules, "config.settings.base")
    monkeypatch.delitem(sys.modules, "config.settings.test")
    return importlib.import_module("config.settings.test")


# --- Nombre exacto de la base de pruebas ----------------------------------


def test_exact_test_database_name_has_no_test_prefix():
    """Django no añade "test_" porque TEST.NAME está definido: se usa sgim_test tal cual."""
    assert connection.creation._get_test_db_name() == "sgim_test"


# --- Lista de nombres permitidos ------------------------------------------


@pytest.mark.parametrize("name", ["sgim_test", "sgim_test_ci", "sgim_test_gw0"])
def test_allowed_test_database_names(name):
    validate_test_db_name(name)


@pytest.mark.parametrize("name", [*DEV_LIKE_NAMES, "", "SGIM_TEST", "sgim_testx", "sgim_test-1"])
def test_rejected_test_database_names(name):
    with pytest.raises(UnsafeTestConfiguration):
        validate_test_db_name(name)


@pytest.mark.parametrize("name", DEV_LIKE_NAMES)
def test_test_settings_reject_non_test_database(monkeypatch, name):
    monkeypatch.setenv("TEST_DB_NAME", name)

    with pytest.raises(ImproperlyConfigured, match="no permitido"):
        _reload_test_settings(monkeypatch)


def test_db_name_variable_cannot_redirect_tests(monkeypatch):
    """DB_NAME se ignora en pruebas: siempre se usa TEST_DB_NAME (por defecto sgim_test)."""
    monkeypatch.setenv("DB_NAME", "sgim_app")
    monkeypatch.delenv("TEST_DB_NAME", raising=False)

    module = _reload_test_settings(monkeypatch)

    assert module.DATABASES["default"]["NAME"] == "sgim_test"
    assert module.DATABASES["default"]["TEST"]["NAME"] == "sgim_test"


def test_test_settings_reject_postgres_superuser(monkeypatch):
    monkeypatch.setenv("DB_USER", "postgres")

    with pytest.raises(ImproperlyConfigured, match="postgres"):
        _reload_test_settings(monkeypatch)


# --- Comprobación global antes de iniciar la sesión de pytest ------------


def test_current_configuration_is_safe():
    validate_environment(settings.SETTINGS_MODULE, settings.DATABASES, reuse_db=False)


@pytest.mark.parametrize("module", ["config.settings.dev", "config.settings.prod", "otro"])
def test_non_test_settings_module_is_rejected(module):
    with pytest.raises(UnsafeTestConfiguration, match="config.settings.test"):
        validate_environment(module, settings.DATABASES, reuse_db=False)


def test_reuse_db_is_rejected():
    with pytest.raises(UnsafeTestConfiguration, match="--reuse-db"):
        validate_environment(settings.SETTINGS_MODULE, settings.DATABASES, reuse_db=True)


@pytest.mark.parametrize("field", ["NAME", "TEST"])
def test_dev_database_in_settings_is_rejected(field):
    db = {**settings.DATABASES["default"]}
    if field == "NAME":
        db["NAME"] = "sgim_app"
    else:
        db["TEST"] = {"NAME": "sgim_app"}

    with pytest.raises(UnsafeTestConfiguration, match="sgim_app"):
        validate_environment(settings.SETTINGS_MODULE, {"default": db}, reuse_db=False)


def test_settings_module_is_pinned_in_pytest_options(pytestconfig):
    assert "--ds=config.settings.test" in pytestconfig.getini("addopts")
