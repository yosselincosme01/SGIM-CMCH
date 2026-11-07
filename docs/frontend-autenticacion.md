# Frontend: autenticación, sesión y vistas por rol

React 19 + TypeScript + Vite, React Router 8. Consume solo los endpoints existentes de
`/api/v1/auth/` (ver [ADR 0002](adr/0002-autenticacion-y-roles.md) y [sesiones](sesiones.md)).

## Rutas

| Ruta | Acceso | Contenido |
|---|---|---|
| `/login` | Público | Inicio de sesión |
| `/` | Con sesión | Inicio: vistas autorizadas según los roles |
| `/solicitante` | Rol `solicitante` | Vista Solicitante |
| `/planificador` | Rol `planificador` | Vista Planificador: bandeja de sus áreas autorizadas |
| `/planificador/incidencias/:code` | Rol `planificador` | Detalle, priorización y programación |
| `/responsable-area/*` | Con sesión | Ruta anterior: redirige a `/planificador/*` |
| `/personal-atencion` | Rol `personal_atencion` | Vista Personal de Atención |
| `/administrador` | Rol `administrador` | Vista Administrador |
| `/sin-acceso` | Con sesión | La vista pedida no corresponde a los roles del usuario |

La restricción por rol en el frontend es **solo de navegación**: la autorización real la
aplica el backend en cada endpoint. Un usuario con varios roles cambia de vista desde el
selector "Vista" de la cabecera, sin volver a iniciar sesión.

## Identidad visual

- **SGIM-CMCH no tiene isotipo propio.** Su identidad es textual: *SGIM-CMCH — Sistema de
  Gestión de Incidencias y Mantenimiento*.
- Logotipos institucionales en `frontend/src/assets/brand/`. Se usan **sin modificar**: sin
  recortes, deformaciones ni cambios de color, con `object-fit: contain` y su proporción
  original. Componente: `shared/ui/InstitutionLogo.tsx`.

| Pantalla | Archivo | Ubicación |
|---|---|---|
| Login | `Logo-CMCH-fondo-blanco.jpg` | Arriba a la derecha de la página, **fuera de la tarjeta** de login, sobre fondo blanco |
| Vistas internas (todas, sea cual sea el rol) | `Logo-CMCH-fondo-guinda.png` | **Extremo izquierdo** de la barra superior guinda (`AppLayout`), seguido del nombre SGIM-CMCH con un separador vertical. Nunca a la derecha |

- Tokens de marca en `src/styles/index.css`: `--color-brand-guinda: #9a1331` es el fondo
  medido del PNG (diferencia máxima de 3 unidades por canal), y `--color-brand-logo-bg:
  #ffffff` es el fondo del JPG. `--color-primary` usa el guinda institucional.
- Responsive: en tabletas y móviles, el logotipo sigue a la izquierda junto al nombre del
  sistema, y los controles pasan a otra fila. En el login, el logotipo se reduce y la tarjeta
  se alinea arriba.

## Estructura

```
src/
  app/                     App y rutas
  shared/api/              Cliente HTTP (client.ts), CSRF, errores y eventos
  shared/ui/               Componentes reutilizables y accesibles
  features/auth/           API, estado (AuthProvider), login, rutas protegidas, roles
  features/session/        Monitor de sesión y avisos de expiración
  features/workspace/      Layout, inicio, páginas de rol
  test/                    Backend simulado con MSW y utilidades de prueba
```

## Cliente HTTP (`src/shared/api/client.ts`)

| Función | Uso | Cabecera `X-SGIM-Passive` | ¿Renueva la inactividad? |
|---|---|---|---|
| `apiRequest()` | Acciones del usuario (navegar, guardar, "Seguir conectado") | No | Sí, si tiene éxito |
| `backgroundRequest()` | Polling, restauración al recargar, obtención del token CSRF | `1` | **Nunca** |

- Mismo origen (`/api/v1`), `credentials: 'same-origin'`, `cache: 'no-store'` y tiempo de
  espera de 15 s.
- `X-CSRFToken` se lee de la cookie `csrftoken` en cada petición POST, PUT, PATCH o DELETE
  (Django rota el token al iniciar sesión).
- **Sin reintentos automáticos.** Antes de cada login se pide un token CSRF nuevo; eso es
  parte del flujo, no un reintento.
- Errores tipados (`ApiError`):
  - `unauthenticated` (401, con `code` y `reason`) y `forbidden` (403, indica si fue CSRF);
  - `validation` (400), `throttled` (429, con `Retry-After`) y `server` (5xx);
  - `network` y `timeout`.

  Nunca se muestra HTML ni texto técnico del servidor.
- Cualquier 401 cierra la sesión local de inmediato (excepto en el login).

## Estado de autenticación

- Vive **solo en memoria**. Nada se guarda en `localStorage` ni `sessionStorage`; la sesión
  es la cookie HttpOnly de Django, que el frontend no puede leer.
- Al recargar, se restaura con `GET /auth/me/` **pasivo**: recargar no renueva la inactividad.
- Al cerrar sesión, el estado local se borra siempre, aunque el servidor no responda, y se
  avisa a las demás pestañas (`BroadcastChannel`).
- Tras iniciar sesión solo se redirige a rutas internas, para evitar redirecciones abiertas.

## Política de sesión en la interfaz

- `GET /auth/session/` (pasivo) se consulta cada 60 s, al volver a la pestaña y poco después
  de cada acción del usuario.
- La cuenta regresiva usa `expires_in`, así que no depende del reloj del equipo.
- A **2 minutos** del vencimiento:
  - **Inactividad**: aviso con "Seguir conectado" (única petición activa) o "Cerrar sesión".
  - **Duración máxima de 8 h**: aviso sin opción de prolongar.
- **Protección visual**: mientras se muestra el aviso, el contenido queda difuminado e
  `inert`. Al expirar, el contenido protegido **se desmonta** y el login explica el motivo.
- **El backend decide**: cuando la cuenta local llega a cero, se consulta al servidor. Solo
  un 401 cierra la sesión.

## Pruebas

```powershell
cd frontend
npm test              # Vitest + React Testing Library + MSW
npm run lint
npm run typecheck
npm run build
```

`src/test/fakeBackend.ts` reproduce el contrato real de Django: CSRF y su rotación, mensaje
genérico ante credenciales incorrectas, 429 con `Retry-After`, 401 con
`session_expired`/`reason`, y renovación de la inactividad solo con peticiones activas.
Cualquier petición no simulada hace fallar la prueba.
