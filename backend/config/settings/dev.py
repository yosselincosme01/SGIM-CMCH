"""Configuración para desarrollo local. Es el único entorno que lee backend/.env."""

from pathlib import Path

from dotenv import load_dotenv

# Debe cargarse antes de importar base.py, que lee las variables de entorno.
# Las variables ya definidas en el entorno tienen prioridad sobre el archivo.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

from .base import *  # noqa: E402, F403
from .base import REST_FRAMEWORK, env_bool, env_list  # noqa: E402

DEBUG = env_bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
)

# Interfaz navegable de DRF solo en desarrollo.
REST_FRAMEWORK = {
    **REST_FRAMEWORK,
    "DEFAULT_RENDERER_CLASSES": [
        *REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"],
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
}
