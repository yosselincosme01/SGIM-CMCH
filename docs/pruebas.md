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
pytest -m "not django_db"                    # solo las pruebas que no usan base de datos
pytest -m django_db                          # solo las que usan base (crean y eliminan sgim_test)
pytest --cov --cov-report=term-missing       # con cobertura

ruff check .                                 # análisis estático (errores, seguridad, imports)
ruff check . --fix                           # corrige automáticamente lo que sea seguro
ruff format --check .                        # verifica el formato sin modificar
ruff format .                                # aplica el formato
```

### Aislamiento del entorno de pruebas

- pytest usa siempre `config.settings.test`. La opción `--ds` está fijada en
  `backend/pyproject.toml`, así que una variable `DJANGO_SETTINGS_MODULE` de la terminal
  no puede sustituirla.
- `config.settings.test` **nunca lee `backend/.env`**. Usa valores ficticios por defecto,
  que se pueden sobrescribir con variables de entorno (por ejemplo, en CI).
- **Nombre exacto de la base:** `sgim_test`. Django **no** añade el prefijo `test_` porque
  `TEST.NAME` está definido explícitamente. `DB_NAME` se ignora en las pruebas.
- **Lista de nombres permitidos** (`config/test_safety.py`): solo `sgim_test` o
  `sgim_test_<sufijo>`. Cualquier otro nombre (`sgim_dev`, `sgim_app`, `test_sgim_app`…)
  aborta la ejecución.
- **Comprobación antes de iniciar** (`backend/conftest.py`): antes de crear o tocar
  ninguna base, pytest aborta con código 4 si:
  - el módulo de configuración no es el de pruebas;
  - se usa `--reuse-db` (incluida la variable `PYTEST_ADDOPTS`);
  - el rol de conexión es `postgres`;
  - o el nombre de la base no está permitido.
- No uses `python manage.py test` (permite `--keepdb`). Las pruebas se ejecutan solo con `pytest`.
- pytest-django **bloquea el acceso a la base de datos** salvo en las pruebas marcadas con
  `@pytest.mark.django_db`.
- Las pruebas de expiración de sesión usan un reloj simulado (fixture `clock` en
  `apps/accounts/tests/conftest.py`): recorren 8 horas o 30 minutos sin esperar.

> **Importante:** pytest-django crea `sgim_test` al empezar y la **elimina** al terminar.
> Si ya existe, la borra y la vuelve a crear. Por eso el nombre se valida con la lista de
> permitidos, y el rol `sgim_test` no tiene acceso a las bases de desarrollo.

### Procedimiento seguro con PostgreSQL

Ver el procedimiento paso a paso en [docs/pruebas-postgresql.md](pruebas-postgresql.md).

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
