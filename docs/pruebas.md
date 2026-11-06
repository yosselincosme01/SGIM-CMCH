# Pruebas automatizadas y calidad del código

Todos los comandos son para **PowerShell** y se ejecutan desde la raíz del repositorio
(`C:\Users\Yosselin\Dev\SGIM-CMCH`).

## Backend (pytest, pytest-django y Ruff)

### Preparación (una sola vez)

```powershell
cd backend
py -3.14 -m venv .venv                       # crea el entorno virtual si no existe
.\.venv\Scripts\Activate.ps1                 # activa el entorno
pip install -r requirements-dev.txt          # instala dependencias de ejecución y de pruebas
```

### Ejecutar

```powershell
cd backend
.\.venv\Scripts\Activate.ps1

pytest                                       # todas las pruebas
pytest apps/core                             # solo una app
pytest -k health                             # pruebas cuyo nombre contiene "health"
pytest --cov --cov-report=term-missing       # con cobertura

ruff check .                                 # análisis estático (errores, seguridad, imports)
ruff check . --fix                           # corrige automáticamente lo que sea seguro
ruff format --check .                        # verifica el formato sin modificar
ruff format .                                # aplica el formato
```

### Aislamiento del entorno de pruebas

- pytest usa `config.settings.test` (definido en `backend/pyproject.toml`).
- `config.settings.test` **nunca lee `backend/.env`**. Usa valores ficticios por defecto,
  que se pueden sobrescribir con variables de entorno (por ejemplo, en CI).
- La base de pruebas es `sgim_test` (variable `TEST_DB_NAME`). Si alguien intenta usar
  `sgim_dev`, `sgim` o `postgres`, la configuración falla de inmediato.
- pytest-django **bloquea el acceso a la base de datos** salvo en las pruebas marcadas con
  `@pytest.mark.django_db`. Las pruebas actuales no usan la base.

> Cuando existan pruebas con `django_db`, pytest-django creará `sgim_test` en PostgreSQL y
> la eliminará al terminar. El usuario de base de datos necesitará permiso `CREATEDB`.
> Esa configuración debe autorizarse antes de hacerse.

## Frontend (Vitest y React Testing Library)

```powershell
cd frontend
npm ci                                       # instala exactamente lo que fija package-lock.json

npm test                                     # ejecuta las pruebas una vez
npm run test:watch                           # modo observación mientras desarrollas
npm run test:coverage                        # cobertura (informe HTML en frontend/coverage/)
npm run lint                                 # ESLint
npm run typecheck                            # comprobación de tipos de TypeScript
npm run build                                # compilación de producción
```

- Las pruebas son `src/**/*.test.tsx` (o `.spec.tsx`) y se ejecutan en `jsdom`.
- La configuración común está en `src/test/setup.ts` (matchers de `jest-dom` y limpieza).

## Verificación completa antes de un commit

```powershell
cd backend;  .\.venv\Scripts\Activate.ps1; ruff check .; ruff format --check .; pytest; cd ..
cd frontend; npm run lint; npm test; npm run build; cd ..
```
