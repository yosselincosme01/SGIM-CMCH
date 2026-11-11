/**
 * Backend simulado con MSW que reproduce el contrato real de Django
 * (backend/apps/accounts y docs/sesiones.md). Solo datos ficticios.
 */
import { http, HttpResponse } from 'msw'

import type { CurrentUser } from '../features/auth/api'

export const TEST_PASSWORD = 'Clave-de-prueba-2026'
export const IDLE_TIMEOUT = 1800
export const ABSOLUTE_TIMEOUT = 28800

type Functions = { can_plan?: boolean; can_attend?: boolean; can_verify?: boolean }

/**
 * ``areas``: funciones efectivas por área, como las calcula el backend (ADR 0009). Las
 * capacidades globales se derivan de ellas.
 */
function makeUser(
  id: number,
  username: string,
  first: string,
  last: string,
  roles: string[],
  areas: Record<string, Functions> = {},
) {
  const area_functions = Object.entries(areas).map(([area, functions]) => ({
    area,
    area_name: area === 'ti' ? 'TI' : area === 'mantenimiento' ? 'Mantenimiento' : 'Ingeniería Clínica',
    can_plan: functions.can_plan === true,
    can_attend: functions.can_attend === true,
    can_verify: functions.can_verify === true,
  }))
  return {
    id,
    username,
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`.trim() || username,
    email: `${username}@example.test`,
    roles,
    capabilities: {
      can_plan: area_functions.some((item) => item.can_plan),
      can_attend: area_functions.some((item) => item.can_attend),
      can_verify: area_functions.some((item) => item.can_verify),
    },
    area_functions,
  } satisfies CurrentUser
}

export const USERS = {
  /** Trabajador con funciones básicas: registrar y consultar sus incidencias. */
  solicitante: makeUser(1, 'ana.prueba', 'Ana', 'Prueba', ['solicitante']),
  /** Varias capacidades: planifica, verifica y atiende en TI. */
  multirol: makeUser(2, 'luis.prueba', 'Luis', 'Prueba', ['planificador', 'personal_atencion'], {
    ti: { can_plan: true, can_verify: true, can_attend: true },
  }),
  /** Administrador sin capacidades operativas. */
  administrador: makeUser(3, 'admin.prueba', 'Eva', 'Prueba', ['administrador']),
  sinRoles: makeUser(4, 'sin.roles', '', '', []),
  /** Técnico con permiso de atención en TI. */
  tecnico: makeUser(5, 'tec.uno', 'Tomás', 'Prueba', ['personal_atencion'], {
    ti: { can_attend: true },
  }),
  /** Solo verifica en TI: sin el rol Responsable de Área ni can_plan (ADR 0008). */
  verificador: makeUser(6, 'vera.prueba', 'Vera', 'Prueba', ['solicitante'], {
    ti: { can_verify: true },
  }),
  /** Responsable de Área que planifica en TI, sin verificar. */
  planificador: makeUser(7, 'pablo.prueba', 'Pablo', 'Prueba', ['planificador'], {
    ti: { can_plan: true },
  }),
  /** Administrador con un rol operativo explícito: ve Inicio y Dashboard general. */
  adminOperativo: makeUser(8, 'marta.prueba', 'Marta', 'Prueba', ['administrador', 'planificador'], {
    ti: { can_plan: true },
  }),
} as const

export interface RecordedRequest {
  method: string
  path: string
  passive: boolean
  csrfHeader: string | null
}

type Reason = 'idle' | 'absolute'

interface BackendState {
  sessionUser: CurrentUser | null
  /** Si tiene valor, la próxima petición autenticada responde 401 session_expired. */
  expiredReason: Reason | null
  /** Segundos restantes que informa GET /auth/session/. */
  expiresIn: number
  /** Qué límite vence primero. */
  limit: Reason
  /** Tras N respuestas correctas de /auth/session/, la sesión expira por inactividad. */
  expireAfterStatusChecks: number | null
  csrfToken: string
  throttleRetryAfter: number | null
  networkDown: boolean
  requests: RecordedRequest[]
}

function initialState(): BackendState {
  return {
    sessionUser: null,
    expiredReason: null,
    expiresIn: IDLE_TIMEOUT,
    limit: 'idle',
    expireAfterStatusChecks: null,
    csrfToken: 'csrf-inicial',
    throttleRetryAfter: null,
    networkDown: false,
    requests: [],
  }
}

export const backend: BackendState & {
  reset: () => void
  signIn: (user: CurrentUser) => void
  requestsTo: (path: string, method?: string) => RecordedRequest[]
} = {
  ...initialState(),
  reset() {
    Object.assign(backend, initialState())
  },
  /** Simula una sesión ya iniciada (por ejemplo, al recargar la página). */
  signIn(user) {
    backend.sessionUser = user
    backend.expiredReason = null
  },
  requestsTo(path, method) {
    return backend.requests.filter(
      (request) => request.path === `/api/v1${path}` && (!method || request.method === method),
    )
  },
}

function setCsrfCookie(token: string) {
  document.cookie = `csrftoken=${token}; path=/`
}

function record(request: Request): RecordedRequest {
  const entry = {
    method: request.method,
    path: new URL(request.url).pathname,
    passive: request.headers.get('X-SGIM-Passive') === '1',
    csrfHeader: request.headers.get('X-CSRFToken'),
  }
  backend.requests.push(entry)
  return entry
}

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return HttpResponse.json(body as Record<string, unknown>, { status, headers })
}

const NOT_AUTHENTICATED = {
  detail: 'Las credenciales de autenticación no se proveyeron.',
  code: 'not_authenticated',
}
const CSRF_FAILED = { detail: 'CSRF Failed: CSRF token missing.' }

/** Equivalente al middleware de política de sesión del backend. */
function requireSession(entry: RecordedRequest) {
  if (backend.expiredReason) {
    const reason = backend.expiredReason
    backend.sessionUser = null
    backend.expiredReason = null
    return json(
      {
        detail: 'La sesión ha expirado. Inicia sesión nuevamente.',
        code: 'session_expired',
        reason,
      },
      401,
    )
  }
  if (!backend.sessionUser) return json(NOT_AUTHENTICATED, 401)
  // Solo las peticiones activas exitosas renuevan la inactividad.
  if (!entry.passive && backend.limit === 'idle') backend.expiresIn = IDLE_TIMEOUT
  return null
}

const API = '*/api/v1'

export const handlers = [
  http.get(`${API}/auth/csrf/`, ({ request }) => {
    record(request)
    if (backend.networkDown) return HttpResponse.error()
    setCsrfCookie(backend.csrfToken)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(`${API}/auth/login/`, async ({ request }) => {
    const entry = record(request)
    if (backend.networkDown) return HttpResponse.error()
    if (backend.throttleRetryAfter !== null) {
      return json({ detail: 'Request was throttled.' }, 429, {
        'Retry-After': String(backend.throttleRetryAfter),
      })
    }
    if (entry.csrfHeader !== backend.csrfToken) return json(CSRF_FAILED, 403)

    const body = (await request.json()) as { username?: string; password?: string }
    const errors: Record<string, string[]> = {}
    if (!body.username) errors.username = ['Este campo no puede estar en blanco.']
    if (!body.password) errors.password = ['Este campo no puede estar en blanco.']
    if (Object.keys(errors).length) return json(errors, 400)

    const user = Object.values(USERS).find((candidate) => candidate.username === body.username)
    if (!user || body.password !== TEST_PASSWORD) {
      return json({ non_field_errors: ['Usuario o contraseña incorrectos.'] }, 400)
    }
    backend.signIn(user)
    backend.expiresIn = IDLE_TIMEOUT
    // Django rota el token CSRF al iniciar sesión.
    backend.csrfToken = 'csrf-rotado'
    setCsrfCookie(backend.csrfToken)
    return json(user)
  }),

  http.post(`${API}/auth/logout/`, ({ request }) => {
    const entry = record(request)
    if (backend.networkDown) return HttpResponse.error()
    const denied = requireSession(entry)
    if (denied) return denied
    if (entry.csrfHeader !== backend.csrfToken) return json(CSRF_FAILED, 403)
    backend.sessionUser = null
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(`${API}/auth/me/`, ({ request }) => {
    const entry = record(request)
    if (backend.networkDown) return HttpResponse.error()
    const denied = requireSession(entry)
    return denied ?? json(backend.sessionUser)
  }),

  http.get(`${API}/auth/session/`, ({ request }) => {
    const entry = record(request)
    if (backend.networkDown) return HttpResponse.error()
    if (backend.expireAfterStatusChecks !== null) {
      if (backend.expireAfterStatusChecks <= 0) backend.expiredReason = 'idle'
      else backend.expireAfterStatusChecks -= 1
    }
    const denied = requireSession({ ...entry, passive: true }) // el servidor la trata como pasiva
    if (denied) return denied
    const now = Date.now()
    const expiresAt = new Date(now + backend.expiresIn * 1000).toISOString()
    const later = new Date(now + (backend.expiresIn + 600) * 1000).toISOString()
    return json({
      server_time: new Date(now).toISOString(),
      expires_at: expiresAt,
      expires_in: backend.expiresIn,
      absolute_expires_at: backend.limit === 'absolute' ? expiresAt : later,
      idle_expires_at: backend.limit === 'idle' ? expiresAt : later,
      absolute_timeout: ABSOLUTE_TIMEOUT,
      idle_timeout: IDLE_TIMEOUT,
    })
  }),
]
