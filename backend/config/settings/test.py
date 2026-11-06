"""
Configuración para pruebas automatizadas.

- Nunca lee backend/.env: las pruebas son reproducibles en cualquier equipo y en CI.
- Solo acepta bases cuyo nombre sea ``sgim_test`` o empiece por ``sgim_test_``
  (ver ``config.test_safety``). Django NO añade el prefijo ``test_`` porque
  ``TEST.NAME`` se define explícitamente: la base que se crea y elimina es esa.
- Los valores por defecto son ficticios y exclusivos de pruebas.
"""

import os

from django.core.exceptions import ImproperlyConfigured

# Valores por defecto solo para pruebas; se pueden sobrescribir desde el entorno
# (por ejemplo, en GitHub Actions o Docker Compose).
os.environ.setdefault("DJANGO_SECRET_KEY", "insecure-test-only-key-not-for-any-real-environment")
os.environ.setdefault("DB_NAME", "sgim_test")
os.environ.setdefault("DB_USER", "sgim_test")

from config.test_safety import (  # noqa: E402
    UnsafeTestConfiguration,
    validate_test_db_name,
    validate_test_db_user,
)

from .base import *  # noqa: E402, F403
from .base import DATABASES, REST_FRAMEWORK, env  # noqa: E402

DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]

TEST_DB_NAME = env("TEST_DB_NAME", "sgim_test")

try:
    validate_test_db_name(TEST_DB_NAME)
    validate_test_db_user(DATABASES["default"]["USER"])
except UnsafeTestConfiguration as exc:
    raise ImproperlyConfigured(str(exc)) from exc

# Copia nueva: no se modifica el diccionario compartido de base.py.
DATABASES = {
    **DATABASES,
    "default": {**DATABASES["default"], "NAME": TEST_DB_NAME, "TEST": {"NAME": TEST_DB_NAME}},
}

# Hasher rápido: solo para pruebas, nunca en otros entornos.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

# Los clientes de prueba de DRF envían JSON, igual que el frontend.
REST_FRAMEWORK = {**REST_FRAMEWORK, "TEST_REQUEST_DEFAULT_FORMAT": "json"}
