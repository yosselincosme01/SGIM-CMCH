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
npm run dev        # http://localhost:5173 (requiere Django en http://127.0.0.1:8000)
```

- Vite redirige `/api` a Django (mismo origen: la cookie de sesión y CSRF funcionan sin CORS).
- Si Django usa otro puerto: `VITE_API_PROXY_TARGET=http://127.0.0.1:8010 npm run dev`.
- Detalles de la interfaz de autenticación: [docs/frontend-autenticacion.md](docs/frontend-autenticacion.md).

## Pruebas y calidad

- Backend: `pytest` y `ruff check .` (desde `backend/` con el entorno activado).
- Frontend: `npm test`, `npm run lint` y `npm run build` (desde `frontend/`).
- La API de salud responde en `GET /api/v1/health/`.
- Autenticación por sesión: `/api/v1/auth/csrf/`, `login/`, `logout/`, `me/` y `session/` ([ADR 0002](docs/adr/0002-autenticacion-y-roles.md)).
- Política de sesión (8 h absolutas y 30 min de inactividad): [docs/sesiones.md](docs/sesiones.md).

- Incidencias (registro y consulta): [ADR 0003](docs/adr/0003-incidencias.md).
- Planificación y asignación (Responsable de Área): [ADR 0004](docs/adr/0004-planificacion.md).
- Identificación del equipo mediante QR: [ADR 0005](docs/adr/0005-identificacion-qr.md).
- Probar el formulario y la cámara desde un celular: [docs/pruebas-movil.md](docs/pruebas-movil.md).
- Atención, cierre técnico, verificación y reapertura: [ADR 0006](docs/adr/0006-atencion-verificacion.md).
- Administración, indicadores y reportes Excel: [ADR 0007](docs/adr/0007-administracion-reportes.md) y [procedimientos](docs/administracion.md).
- Funciones independientes por área (planificar, registrar atenciones, verificar conformidad): [ADR 0008](docs/adr/0008-funciones-independientes-por-area.md).
- Navegación unificada por capacidades (menú lateral, sin selector de roles): [ADR 0009](docs/adr/0009-navegacion-por-capacidades.md).
- Inicio como dashboard operativo personal: [ADR 0010](docs/adr/0010-inicio-dashboard-operativo.md).
- Panel de Administración: [ADR 0011](docs/adr/0011-panel-de-administracion.md).
- Configurar pertenencias de demostración: [docs/planificacion-pertenencias.md](docs/planificacion-pertenencias.md).

Guía completa para PowerShell: [docs/pruebas.md](docs/pruebas.md).

## Datos

No se deben usar datos reales de pacientes en desarrollo, pruebas ni fixtures.
