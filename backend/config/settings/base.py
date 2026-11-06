"""
Configuración común a todos los entornos de SGIM-CMCH.

Los valores sensibles o dependientes del entorno se leen de variables de
entorno. Solo ``dev.py`` carga ``backend/.env`` (no versionado); ``test.py``
y ``prod.py`` nunca lo leen. Consulta ``backend/.env.example``.
"""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

# backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent


def env(name: str, default: str | None = None, *, required: bool = False) -> str | None:
    value = os.getenv(name, default)
    if required and not value:
        raise ImproperlyConfigured(
            f"La variable de entorno {name} es obligatoria. Consulta backend/.env.example."
        )
    return value


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


# --- Seguridad básica -------------------------------------------------------

SECRET_KEY = env("DJANGO_SECRET_KEY", required=True)
DEBUG = env_bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")


# --- Aplicaciones -----------------------------------------------------------

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
]

LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.accounts.middleware.SessionPolicyMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"


# --- Base de datos ----------------------------------------------------------

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_NAME", required=True),
        "USER": env("DB_USER", required=True),
        "PASSWORD": env("DB_PASSWORD", ""),
        "HOST": env("DB_HOST", "localhost"),
        "PORT": env("DB_PORT", "5432"),
        "CONN_MAX_AGE": int(env("DB_CONN_MAX_AGE", "0")),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --- Autenticación ----------------------------------------------------------
# Modelo de usuario propio (ver docs/adr/0002). Debe existir desde la primera
# migración de la base de datos.

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# --- Internacionalización ---------------------------------------------------

LANGUAGE_CODE = "es"
TIME_ZONE = env("DJANGO_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True


# --- Archivos estáticos y subidos ------------------------------------------

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"


# --- API REST (Django REST Framework) --------------------------------------
# Política segura por defecto: todo endpoint exige autenticación salvo que
# declare explícitamente lo contrario (p. ej. el endpoint de salud).

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.accounts.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "apps.accounts.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "login": env("DJANGO_LOGIN_THROTTLE_RATE", "5/min"),
    },
}


# --- Sesión y CSRF ----------------------------------------------------------
# Autenticación por sesión en el mismo origen que el frontend (ver docs/adr/0002).
#
# Política de sesión (apps.accounts.session_policy), verificada en el servidor:
# - SGIM_SESSION_ABSOLUTE_TIMEOUT: duración máxima desde el inicio de sesión.
#   La actividad NO la amplía.
# - SGIM_SESSION_IDLE_TIMEOUT: inactividad máxima desde la última actividad válida.
# La sesión expira al alcanzar cualquiera de los dos.

SGIM_SESSION_ABSOLUTE_TIMEOUT = int(env("SGIM_SESSION_ABSOLUTE_TIMEOUT", str(8 * 60 * 60)))
SGIM_SESSION_IDLE_TIMEOUT = int(env("SGIM_SESSION_IDLE_TIMEOUT", str(30 * 60)))

if not 0 < SGIM_SESSION_IDLE_TIMEOUT <= SGIM_SESSION_ABSOLUTE_TIMEOUT:
    raise ImproperlyConfigured(
        "Se requiere 0 < SGIM_SESSION_IDLE_TIMEOUT <= SGIM_SESSION_ABSOLUTE_TIMEOUT."
    )

# SESSION_COOKIE_AGE NO es el límite absoluto: solo acota cuánto se conservan la
# cookie y el registro de sesión. Se iguala al límite absoluto como tope de almacenamiento.
SESSION_COOKIE_AGE = SGIM_SESSION_ABSOLUTE_TIMEOUT
# La sesión solo se guarda cuando cambia (p. ej. al registrar actividad válida);
# las peticiones pasivas no la modifican.
SESSION_SAVE_EVERY_REQUEST = False
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"

# El frontend lee la cookie csrftoken y la envía en la cabecera X-CSRFToken,
# por eso no puede ser HttpOnly. La cookie de sesión sí lo es.
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"


# --- Cabeceras de seguridad comunes ----------------------------------------

SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
