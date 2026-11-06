"""Configuración global de pytest para el backend."""

import pytest


def pytest_sessionstart(session: pytest.Session) -> None:
    """
    Aborta la ejecución, antes de crear o tocar cualquier base de datos, si la
    configuración pudiera apuntar a una base que no sea de pruebas.
    """
    from django.conf import settings

    from config.test_safety import UnsafeTestConfiguration, validate_environment

    try:
        validate_environment(
            settings.SETTINGS_MODULE,
            settings.DATABASES,
            reuse_db=bool(session.config.getoption("reuse_db", default=False)),
        )
    except UnsafeTestConfiguration as exc:
        pytest.exit(f"Configuración de pruebas insegura: {exc}", returncode=4)
