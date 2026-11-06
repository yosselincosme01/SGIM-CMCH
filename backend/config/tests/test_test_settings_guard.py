"""La configuración de pruebas debe negarse a usar la base de desarrollo."""

import importlib
import sys

import pytest
from django.core.exceptions import ImproperlyConfigured


@pytest.mark.parametrize("protected_name", ["sgim_dev", "postgres"])
def test_test_settings_reject_protected_database(monkeypatch, protected_name):
    monkeypatch.setenv("TEST_DB_NAME", protected_name)
    # monkeypatch restaura el módulo original al terminar la prueba.
    monkeypatch.delitem(sys.modules, "config.settings.test")

    with pytest.raises(ImproperlyConfigured, match=protected_name):
        importlib.import_module("config.settings.test")
