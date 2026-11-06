"""Configuración para la ejecución de pruebas automatizadas."""

from .base import *  # noqa: F403

DEBUG = False

# Hasher rápido: solo para pruebas, nunca en otros entornos.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
