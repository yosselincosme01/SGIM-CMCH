# ADR 0002: Usuario personalizado, roles y autenticación por sesión

- **Estado:** aceptado
- **Fecha:** 2026-11-06
- **Reemplaza a:** [ADR 0001](0001-modelo-usuario-personalizado.md)

## Contexto

`sgim_dev` ya tiene aplicadas las migraciones iniciales de Django con `auth.User`.
Todavía no hay usuarios reales ni modelos de negocio. Necesitamos autenticación
individual, permisos por rol y una base que pueda crecer.

Django no permite cambiar `AUTH_USER_MODEL` en una base ya migrada:
`admin.0001_initial` depende de `AUTH_USER_MODEL`, y Django lanza
`InconsistentMigrationHistory`.

## Decisiones

### 1. Modelo de usuario: `accounts.User(AbstractUser)` en una base nueva

- El modelo usa su propia tabla, `accounts_user`, y existe desde la primera migración.
- Se usa una **base nueva, `sgim_app`**, migrada desde cero. `sgim_dev` **no se
  modifica ni se elimina**: queda como respaldo y la responsable decidirá si la borra.
- Se descartan otras opciones:
  - Reutilizar `auth_user` manipulando `django_migrations` (era el ADR 0001).
  - `auth.User` con un perfil asociado, porque genera deuda técnica.
- **Cuentas individuales**: cada persona tiene su propio `username` y su contraseña. No
  se permiten cuentas compartidas, tampoco para solicitantes. El `username` es único sin
  distinguir mayúsculas (restricción `accounts_user_username_ci_unique`).
- **Sin vínculo con UPS o servicio**: el usuario no tiene ningún campo de unidad. El
  personal puede rotar entre unidades (situación pendiente de validar), y la UPS donde
  ocurre una incidencia será un dato del ticket.

### 2. Roles: Groups de Django, y un usuario puede tener varios

| Grupo | Rol | Responsabilidad funcional |
|---|---|---|
| `administrador` | Administrador | Gestiona usuarios, roles y catálogos |
| `solicitante` | Solicitante | Registra incidencias y hace su seguimiento |
| `planificador` | Planificador | Gestiona prioridades, programación, asignaciones y supervisión, según sus autorizaciones |
| `personal_atencion` | Personal de atención | Registra las actividades y los resultados de las atenciones asignadas |

- **Mínimo privilegio**: la migración `accounts.0002` crea los grupos **sin permisos**.
  Los permisos específicos sobre incidencias se definirán y validarán con la clínica
  al desarrollar ese módulo.
- Para comprobar roles en el código: `apps.accounts.roles.has_role` y las clases de
  permiso de `apps.accounts.permissions` (`require_roles`, `IsPlanificador`, etc.).
- `is_superuser` se reserva para el soporte técnico del sitio de administración. **No**
  concede roles funcionales ni acceso global a incidencias: `has_role` solo considera los
  roles asignados de forma explícita (cambio introducido por el [ADR 0004](0004-planificacion.md)).
- Las reglas sobre objetos concretos (por ejemplo, "solo sus incidencias") se
  implementarán en cada módulo de negocio.

### 3. Autenticación: sesión de Django con CSRF, en el mismo origen

- El frontend y la API se sirven bajo el mismo dominio: en desarrollo con el proxy
  `/api` de Vite y en producción con un proxy inverso. Así no hace falta CORS.
- La cookie de sesión es `HttpOnly` y `SameSite=Lax`, y en producción también `Secure`.
- **Política de sesión**: la verifica el servidor (`SessionPolicyMiddleware`) con dos
  límites independientes y configurables. La sesión expira al alcanzar cualquiera:
  - duración máxima **absoluta** de **8 h** desde el inicio de sesión
    (`SGIM_SESSION_ABSOLUTE_TIMEOUT`); la actividad no la amplía;
  - **inactividad** máxima de **30 min** desde la última actividad válida
    (`SGIM_SESSION_IDLE_TIMEOUT`).

  Las peticiones pasivas (cabecera `X-SGIM-Passive: 1` y `auth/session/`) no cuentan
  como actividad. Al expirar, la sesión se invalida y la API responde 401 con
  `code="session_expired"`. Detalles en [docs/sesiones.md](../sesiones.md).
- La cookie `csrftoken` es legible por JavaScript. El frontend la envía en `X-CSRFToken`.
- El login comprueba CSRF de forma explícita (DRF solo lo hace con usuarios
  autenticados) y rota el identificador de sesión.
- El login admite como máximo 5 intentos por minuto (`ScopedRateThrottle`, configurable).
- Sin sesión, la API responde **401**; sin permiso, **403**.
- Se descarta JWT: los tokens en el navegador quedan expuestos ante XSS y son
  difíciles de revocar. Se reconsiderará si aparece una app móvil o integraciones externas.

### 4. Endpoints (`/api/v1/auth/`)

| Método | Ruta | Acceso | Respuesta |
|---|---|---|---|
| GET | `csrf/` | Público | 204 y la cookie `csrftoken` |
| POST | `login/` | Público, con CSRF y límite de intentos | 200 con el usuario y sus roles · 400 con un mensaje genérico · 403 sin CSRF · 429 |
| POST | `logout/` | Con sesión y CSRF | 204 · 401 |
| GET | `me/` | Con sesión | 200 con `id`, `username`, nombres, `email` y `roles` · 401 |
| GET | `session/` | Con sesión; **pasivo** | 200 con los instantes de expiración (absoluto, inactividad y el más próximo) · 401 |

Todas las respuestas 401 incluyen `code`: `not_authenticated` o `session_expired`
(este último con `reason`: `idle`, `absolute` o `invalid`).

## Consecuencias

- Desarrollo usa `DB_NAME=sgim_app`, que la responsable crea y migra manualmente.
- Las pruebas que usan la base requieren `sgim_test`. pytest-django la crea y la
  elimina, y el usuario de PostgreSQL necesita `CREATEDB`. Está pendiente de autorizar.
- En producción con varios procesos, el límite de intentos necesita una caché
  compartida (por ejemplo, Redis).
- Cada petición activa guarda la sesión para registrar la actividad: es una escritura
  en `django_session` por petición, aceptable para el volumen previsto.
- Pendiente para ramas posteriores: cambio y recuperación de contraseña, gestión de
  usuarios desde la API y frontend de login.
