# Procedimiento seguro: pruebas del backend con PostgreSQL

Lo ejecuta **manualmente** la responsable del proyecto en PowerShell (Windows PowerShell
5.1 o PowerShell 7). Ningún paso lee ni modifica `backend/.env`.

**Objetivo:** que pytest cree, use y elimine **solo** `sgim_test`, con un rol exclusivo
(`sgim_test`) que no pueda conectarse a `sgim_dev` ni a `sgim_app`.

> Garantías ya incluidas en el código (ver `docs/pruebas.md`):
> - configuración fijada con `--ds=config.settings.test`;
> - lista de nombres permitidos (`sgim_test` y `sgim_test_*`);
> - bloqueo de `--reuse-db` y del rol `postgres`;
> - `.env` nunca se lee durante las pruebas.
>
> Este procedimiento añade la **barrera en PostgreSQL**. Si el código fallara, el rol de
> pruebas seguiría sin acceso a las bases de desarrollo y sin poder borrarlas.

## 0. Preparación

Abre una **ventana nueva** de PowerShell y define la ruta de `psql`. Ajústala si
PostgreSQL 18 está instalado en otro lugar.

```powershell
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
```

Comprueba que la terminal no tiene variables que puedan influir en las pruebas. Solo se
muestran los **nombres**, no los valores:

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -match '^(DB_|PG|DJANGO_|TEST_DB|SGIM_|PYTEST)' } | Select-Object Name
```

Lo esperado es que no aparezca ninguna. Si aparece alguna, elimínala solo de esta
terminal, por ejemplo: `Remove-Item Env:DJANGO_SETTINGS_MODULE`.

## 1. Estado actual de las bases (solo lectura)

```powershell
& $psql -U postgres -d postgres -c "SELECT datname, pg_get_userbyid(datdba) AS propietario, datacl FROM pg_database WHERE datname IN ('sgim_dev','sgim_app','sgim_test') ORDER BY datname;"
```

- Anota el **propietario** de `sgim_dev` y de `sgim_app` si ya existe. Es tu rol de desarrollo.
- `datacl` vacío significa permisos por defecto: **cualquier rol (`PUBLIC`) puede conectarse**.
  Por eso hace falta el paso 3.
- `sgim_test` **no debe existir**. Si existe, no sigas: pytest la borraría. Revisa antes
  qué contiene y de quién es.

## 2. Crear el rol exclusivo de pruebas

```powershell
& $psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE sgim_test LOGIN CREATEDB NOSUPERUSER NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;"
```

Crea el rol con el permiso justo para crear su propia base. No es superusuario ni puede
crear roles.

```powershell
& $psql -U postgres -d postgres -c "\password sgim_test"
```

Pide la contraseña de forma interactiva, así no queda en el historial de comandos.

## 3. Impedir que el rol de pruebas se conecte a las bases de desarrollo

En los comandos, sustituye `<rol_dev>` por el propietario anotado en el paso 1.

```powershell
& $psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "REVOKE CONNECT, TEMPORARY ON DATABASE sgim_dev FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE sgim_dev TO <rol_dev>;"
```

Quita la conexión por defecto de `PUBLIC` a `sgim_dev` y se la concede explícitamente a tu
rol de desarrollo, para que siga funcionando.

Si `sgim_app` ya existe, aplica lo mismo. Si todavía no existe, ejecuta este comando
**inmediatamente después** de crearla:

```powershell
& $psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "REVOKE CONNECT, TEMPORARY ON DATABASE sgim_app FROM PUBLIC; GRANT CONNECT, TEMPORARY ON DATABASE sgim_app TO <rol_dev>;"
```

> No revoques nada sobre la base `postgres`. pytest-django se conecta a ella para
> ejecutar `CREATE DATABASE sgim_test` y `DROP DATABASE sgim_test`.

## 4. Verificar las barreras (solo lectura)

```powershell
& $psql -U postgres -d postgres -c "SELECT d.datname, has_database_privilege('sgim_test', d.datname, 'CONNECT') AS puede_conectar FROM pg_database d WHERE d.datname IN ('sgim_dev','sgim_app','postgres') ORDER BY 1;"
```

Debe mostrar `f` para `sgim_dev` y `sgim_app`, y `t` para `postgres`.

```powershell
& $psql -U postgres -d postgres -c "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = 'sgim_test'; SELECT r.rolname AS miembro_de FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid WHERE m.member = 'sgim_test'::regrole;"
```

Debe mostrar `rolcreatedb = t` y el resto en `f`. La segunda consulta debe salir vacía:
el rol no pertenece a ningún otro.

```powershell
& $psql -U sgim_test -d sgim_dev -c "SELECT 1;"
```

Debe **fallar** con `permission denied for database "sgim_dev"`. Repite con `-d sgim_app`
si ya existe.

> El rol `sgim_test` tampoco puede ejecutar `DROP DATABASE sgim_dev` ni sobre `sgim_app`:
> en PostgreSQL solo el propietario o un superusuario pueden borrar una base.

## 5. Ejecutar las pruebas

Desde la raíz del repositorio:

```powershell
cd backend; .\.venv\Scripts\Activate.ps1
```

```powershell
$env:DB_USER = "sgim_test"; $env:TEST_DB_NAME = "sgim_test"; $env:DB_HOST = "localhost"
```

Fija explícitamente el rol y la base de pruebas, solo en esta terminal. `DB_NAME` no hace
falta: las pruebas lo ignoran.

```powershell
$p = Read-Host "Contraseña de sgim_test" -AsSecureString; $env:DB_PASSWORD = [System.Net.NetworkCredential]::new("", $p).Password; Remove-Variable p
```

Carga la contraseña sin mostrarla ni guardarla en un archivo.

```powershell
pytest --collect-only | Select-String "settings:|collected"
```

Comprobación previa sin base de datos. Debe indicar `settings: config.settings.test (from option)` y `140 items`.

```powershell
pytest -m "not django_db"
```

Ejecuta primero las pruebas que no usan base de datos.

```powershell
pytest
```

Ejecuta la suite completa. pytest-django crea `sgim_test`, aplica las migraciones, ejecuta
las pruebas y **elimina** `sgim_test` al terminar. **No añadas** `--reuse-db`, `--create-db`
ni `-p xdist`.

## 6. Comprobar la limpieza y cerrar

```powershell
& $psql -U postgres -d postgres -c "SELECT datname FROM pg_database WHERE datname LIKE 'sgim_test%';"
```

Debe salir vacío: la base de pruebas se eliminó.

```powershell
Remove-Item Env:DB_PASSWORD, Env:DB_USER, Env:TEST_DB_NAME, Env:DB_HOST
```

Borra las variables de esta terminal.

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| `Configuración de pruebas insegura: ...` (código 4) | La comprobación previa detectó un riesgo. Lee el mensaje; no se tocó ninguna base |
| `Nombre de base de pruebas no permitido` | `TEST_DB_NAME` tiene un valor distinto de `sgim_test` o `sgim_test_*` |
| `permission denied to create database` | Al rol `sgim_test` le falta `CREATEDB` |
| `password authentication failed for user "sgim_test"` | Contraseña incorrecta en `DB_PASSWORD` |
| `database "sgim_test" already exists` y luego `DROP` | Quedó una base de una ejecución interrumpida; pytest la recrea, porque su nombre está permitido |
