"""
Configuración para pruebas automatizadas.

- Nunca lee backend/.env: las pruebas son reproducibles en cualquier equipo y en CI.
- Usa una base de datos propia (por defecto ``sgim_test``), nunca ``sgim_dev``.
- Los valores por defecto son ficticios y exclusivos de pruebas.
"""

import os

from django.core.exceptions import ImproperlyConfigured

# Valores por defecto solo para pruebas; se pueden sobrescribir desde el entorno
# (por ejemplo, en GitHub Actions o Docker Compose).
os.environ.setdefault("DJANGO_SECRET_KEY", "insecure-test-only-key-not-for-any-real-environment")
os.environ.setdefault("DB_NAME", "sgim_test")
os.environ.setdefault("DB_USER", "sgim_test")

from .base import *  # noqa: E402, F403
from .base import DATABASES, env  # noqa: E402

DEBUG = False
ALLOWED_HOSTS = ["testserver", "localhost"]

TEST_DB_NAME = env("TEST_DB_NAME", "sgim_test")
PROTECTED_DB_NAMES = {"sgim_dev", "sgim", "postgres"}

if TEST_DB_NAME in PROTECTED_DB_NAMES:
    raise ImproperlyConfigured(
        f"Las pruebas no pueden usar la base de datos '{TEST_DB_NAME}'. "
        "Define TEST_DB_NAME con una base exclusiva para pruebas."
    )

# Copia nueva: no se modifica el diccionario compartido de base.py.
DATABASES = {
    **DATABASES,
    "default": {**DATABASES["default"], "NAME": TEST_DB_NAME, "TEST": {"NAME": TEST_DB_NAME}},
}

# Hasher rápido: solo para pruebas, nunca en otros entornos.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
