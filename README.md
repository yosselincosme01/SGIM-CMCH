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
cp .env.example .env            # completa los valores; nunca lo subas al repositorio
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

## Datos

No se deben usar datos reales de pacientes en desarrollo, pruebas ni fixtures.
