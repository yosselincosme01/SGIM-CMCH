"""
Salvaguardas para que las pruebas nunca usen ni borren una base que no sea de pruebas.

pytest-django crea la base de pruebas en modo no interactivo: si ya existe, ejecuta
``DROP DATABASE`` sobre ella y la vuelve a crear. Por eso el nombre se valida con una
**lista de nombres permitidos** (no con una lista de prohibidos) antes de tocar la base.
"""

import re

# Nombres permitidos: "sgim_test" y variantes como "sgim_test_ci" o "sgim_test_gw0".
TEST_DB_NAME_PATTERN = re.compile(r"^sgim_test(_[a-z0-9]+)*$")

# Roles que nunca deben usarse para las pruebas (pueden borrar cualquier base).
FORBIDDEN_TEST_DB_USERS = frozenset({"postgres"})

# Módulos de configuración aceptados para ejecutar pytest.
ALLOWED_SETTINGS_PREFIX = "config.settings.test"

POSTGRES_ENGINE = "django.db.backends.postgresql"
SQLITE_ENGINE = "django.db.backends.sqlite3"


class UnsafeTestConfiguration(Exception):
    """La configuración de pruebas podría afectar a una base que no es de pruebas."""


def validate_test_db_name(name: str) -> None:
    if not TEST_DB_NAME_PATTERN.fullmatch(name or ""):
        raise UnsafeTestConfiguration(
            f"Nombre de base de pruebas no permitido: '{name}'. "
            "Debe ser 'sgim_test' o empezar por 'sgim_test_' (por ejemplo, 'sgim_test_ci')."
        )


def validate_test_db_user(user: str) -> None:
    if (user or "").lower() in FORBIDDEN_TEST_DB_USERS:
        raise UnsafeTestConfiguration(
            f"El rol '{user}' no puede usarse para las pruebas. Usa el rol exclusivo 'sgim_test'."
        )


def validate_environment(settings_module: str, databases: dict, *, reuse_db: bool) -> None:
    """Comprueba la configuración completa antes de que pytest cree cualquier base."""
    if not (
        settings_module == ALLOWED_SETTINGS_PREFIX
        or settings_module.startswith(ALLOWED_SETTINGS_PREFIX + "_")
    ):
        raise UnsafeTestConfiguration(
            f"pytest debe ejecutarse con 'config.settings.test', no con '{settings_module}'. "
            "Revisa la variable DJANGO_SETTINGS_MODULE y la opción --ds."
        )

    if reuse_db:
        raise UnsafeTestConfiguration(
            "--reuse-db no está autorizado: la base de pruebas debe crearse y eliminarse "
            "en cada ejecución. Revisa también la variable PYTEST_ADDOPTS."
        )

    for alias, db in databases.items():
        engine = db.get("ENGINE")
        if engine == SQLITE_ENGINE and db.get("NAME") == ":memory:":
            continue  # base efímera en memoria (solo verificación aislada)
        if engine != POSTGRES_ENGINE:
            raise UnsafeTestConfiguration(f"Motor no permitido en '{alias}': {engine}")
        validate_test_db_user(db.get("USER", ""))
        validate_test_db_name(db.get("NAME", ""))
        validate_test_db_name((db.get("TEST") or {}).get("NAME") or "")
