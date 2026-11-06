# SGIM-CMCH

Sistema de Gestión de Incidencias y Mantenimiento.

Monorepositorio con monolito modular:

| Carpeta | Tecnología |
|---|---|
| `backend/` | Python 3.14, Django 6, Django REST Framework, PostgreSQL 18 |
| `frontend/` | React 19, TypeScript, Vite |
| `docs/adr/` | Registro de decisiones de arquitectura |

## Requisitos

- Python 3.14 (ver `backend/.python-version`)
- Node.js 24 (ver `frontend/.nvmrc`)
- PostgreSQL 18

## Backend

```bash
cd backend
py -3.14 -m venv .venv
.venv/Scripts/activate          # Windows (Git Bash: source .venv/Scripts/activate)
pip install -r requirements-dev.txt
cp .env.example .env            # completa los valores (DB_NAME=sgim_app); nunca lo subas al repositorio
python manage.py migrate
python manage.py runserver
```

Módulos de configuración (`DJANGO_SETTINGS_MODULE`):

- `config.settings.dev`: por defecto en `manage.py`
- `config.settings.test`: pruebas automatizadas
- `config.settings.prod`: por defecto en `wsgi.py` / `asgi.py`

## Frontend

```bash
cd frontend
npm ci
npm run dev
```

## Pruebas y calidad

- Backend: `pytest` y `ruff check .` (desde `backend/` con el entorno activado).
- Frontend: `npm test`, `npm run lint` y `npm run build` (desde `frontend/`).
- La API de salud responde en `GET /api/v1/health/`.
- Autenticación por sesión: `/api/v1/auth/csrf/`, `login/`, `logout/`, `me/` y `session/` ([ADR 0002](docs/adr/0002-autenticacion-y-roles.md)).
- Política de sesión (8 h absolutas y 30 min de inactividad): [docs/sesiones.md](docs/sesiones.md).

Guía completa para PowerShell: [docs/pruebas.md](docs/pruebas.md).

## Datos

No se deben usar datos reales de pacientes en desarrollo, pruebas ni fixtures.
