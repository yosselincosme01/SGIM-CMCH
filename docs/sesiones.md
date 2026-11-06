# Política de sesiones

La aplica el servidor (`apps.accounts.session_policy` y `SessionPolicyMiddleware`).
React solo muestra avisos: **nunca decide** si una sesión sigue vigente.

## Límites

| Límite | Variable | Valor por defecto | Se cuenta desde | ¿La actividad lo renueva? |
|---|---|---|---|---|
| Duración máxima absoluta | `SGIM_SESSION_ABSOLUTE_TIMEOUT` (segundos) | `28800` (8 h) | El inicio de sesión | **No** |
| Inactividad máxima | `SGIM_SESSION_IDLE_TIMEOUT` (segundos) | `1800` (30 min) | La última actividad válida | Sí |

- La sesión expira al alcanzar **cualquiera** de los dos límites.
- La configuración exige `0 < inactividad ≤ absoluto`. Si no se cumple, Django no arranca.
- `SESSION_COOKIE_AGE` **no** es el límite absoluto. Al iniciar sesión, la caducidad de la
  cookie y del registro de sesión se fija en el instante absoluto de fin, para que ninguna
  actividad la prolongue. La decisión de expirar se toma siempre con las marcas de tiempo
  guardadas en la sesión.
- Cookies:
  - La de sesión es `HttpOnly` y `SameSite=Lax`.
  - `csrftoken` es legible por JavaScript y `SameSite=Lax`.
  - En producción, ambas son `Secure`.

## Actividad válida

Cuenta como actividad una petición que cumple **todas** estas condiciones:

1. Tiene una sesión autenticada y vigente.
2. Llega a una vista de la aplicación. Una ruta inexistente o una redirección generada
   por otro middleware no cuentan.
3. **No** es pasiva.
4. Termina con éxito, con un código HTTP menor que 400. Los errores, como 403, 404 o
   405, no cuentan.

Una petición es **pasiva** si:

- envía la cabecera `X-SGIM-Passive: 1`, o
- se dirige a una vista declarada como pasiva. Por ahora solo `GET /api/v1/auth/session/`.

Las peticiones pasivas **nunca** renuevan la inactividad, aunque se repitan indefinidamente.

## Respuesta ante una sesión vencida

El servidor invalida la sesión (`logout`) y elimina la cookie. Los endpoints protegidos
responden:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Session realm="api"

{"detail": "La sesión ha expirado. Inicia sesión nuevamente.", "code": "session_expired", "reason": "idle"}
```

- `reason` puede ser `idle` (inactividad), `absolute` (duración máxima) o `invalid`
  (sesión sin marcas de tiempo, que se rechaza por seguridad).
- Una petición sin sesión responde `401` con `"code": "not_authenticated"`.
- Los endpoints públicos (`auth/csrf/`, `auth/login/` y `health/`) siguen funcionando,
  así que se puede volver a iniciar sesión de inmediato. Cada inicio de sesión abre una
  ventana absoluta nueva de 8 horas.

## Información para el frontend: `GET /api/v1/auth/session/`

Requiere sesión. Es pasiva: consultarla no cuenta como actividad.

```json
{
  "server_time": "2026-11-06T13:00:00+00:00",
  "expires_at": "2026-11-06T13:30:00+00:00",
  "expires_in": 1800,
  "absolute_expires_at": "2026-11-06T21:00:00+00:00",
  "idle_expires_at": "2026-11-06T13:30:00+00:00",
  "absolute_timeout": 28800,
  "idle_timeout": 1800
}
```

- `expires_at` es el límite que llega primero, y `expires_in`, los segundos que faltan
  para alcanzarlo.
- Las fechas están en UTC (ISO 8601). Usa `server_time` para corregir la diferencia de
  reloj del equipo.
- No expone el identificador de sesión ni datos del usuario.

## Uso previsto desde React (contrato para la futura rama del frontend)

El servidor no puede saber si una petición la originó una persona o un temporizador. Por
eso el frontend **debe** cumplir estas reglas, y la rama del frontend incluirá pruebas que
las verifiquen.

1. **Un único cliente de API** (`src/shared/api`) con dos funciones explícitas:
   - `apiRequest()`: peticiones originadas por el usuario (navegar, guardar, filtrar).
     Renuevan la inactividad si tienen éxito.
   - `backgroundRequest()`: añade siempre `X-SGIM-Passive: 1`. Es **obligatoria** para
     polling, refrescos en segundo plano, reintentos automáticos y comprobaciones de sesión.

   Prohibido llamar a `fetch` directamente desde los componentes.
2. **Sin refrescos automáticos implícitos.** Si se usa una librería de datos (por ejemplo,
   TanStack Query), desactivar globalmente `refetchOnWindowFocus`, `refetchOnReconnect` y
   `refetchInterval`. Cualquier refresco periódico debe usar `backgroundRequest()`.
3. **Avisos de expiración**: consultar `auth/session/`, que es pasivo en el servidor, con
   `backgroundRequest()`, por ejemplo cada minuto, o programar un temporizador con
   `expires_in`. Mostrar un aviso cuando falten, por ejemplo, 2 minutos:
   - Si `expires_at == idle_expires_at`, ofrecer **"Seguir conectado"**. Ese botón
     hace una petición **activa** con `apiRequest()`, como `GET auth/me/`.
   - Si `expires_at == absolute_expires_at`, la sesión no se puede extender: avisar de
     que habrá que volver a iniciar sesión.
4. **Cualquier `401`**: con `code` igual a `session_expired` o `not_authenticated`,
   descartar el estado local y redirigir al login. Si es `session_expired`, mostrar el
   motivo.
5. Los eventos de ratón o teclado **no** renuevan la sesión por sí solos. Solo cuentan
   las peticiones al servidor.
6. **Pruebas obligatorias en el frontend** (Vitest + MSW): el polling de sesión y todo
   refresco automático envían `X-SGIM-Passive: 1`; las acciones del usuario no lo envían;
   un `401 session_expired` redirige al login.

**Red de seguridad del servidor:** aunque el frontend cometiera un error y su polling
contara como actividad, la sesión **nunca** supera la duración absoluta de 8 horas. El
límite absoluto no depende de ninguna cabecera.
