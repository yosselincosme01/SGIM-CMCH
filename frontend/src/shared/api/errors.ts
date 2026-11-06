/** Errores normalizados del cliente de API. Nunca contienen HTML ni datos sensibles. */

export type ApiErrorKind =
  | 'network' // sin respuesta del servidor (sin conexión, CORS, servidor caído)
  | 'timeout' // el servidor no respondió a tiempo
  | 'unauthenticated' // 401: sin sesión o sesión vencida
  | 'forbidden' // 403: sesión válida sin permiso, o CSRF rechazado
  | 'validation' // 400: datos no válidos
  | 'throttled' // 429: demasiados intentos
  | 'server' // 5xx
  | 'http' // cualquier otro código no esperado

export type SessionExpiredReason = 'idle' | 'absolute' | 'invalid'

export interface ApiErrorInit {
  kind: ApiErrorKind
  status: number
  message: string
  code?: string
  reason?: SessionExpiredReason
  fieldErrors?: Record<string, string[]>
  retryAfterSeconds?: number
  isCsrfFailure?: boolean
}

const MAX_MESSAGE_LENGTH = 300

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number
  readonly code?: string
  readonly reason?: SessionExpiredReason
  readonly fieldErrors: Record<string, string[]>
  readonly retryAfterSeconds?: number
  readonly isCsrfFailure: boolean

  constructor(init: ApiErrorInit) {
    super(init.message.slice(0, MAX_MESSAGE_LENGTH))
    this.name = 'ApiError'
    this.kind = init.kind
    this.status = init.status
    this.code = init.code
    this.reason = init.reason
    this.fieldErrors = init.fieldErrors ?? {}
    this.retryAfterSeconds = init.retryAfterSeconds
    this.isCsrfFailure = init.isCsrfFailure ?? false
  }

  get isSessionExpired(): boolean {
    return this.kind === 'unauthenticated' && this.code === 'session_expired'
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

type ErrorBody = Record<string, unknown> | null

function asStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string')
    return items.length ? items : undefined
  }
  return undefined
}

function fieldErrorsFrom(body: ErrorBody): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  if (!body) return errors
  for (const [key, value] of Object.entries(body)) {
    if (key === 'detail' || key === 'code' || key === 'reason') continue
    const list = asStringList(value)
    if (list) errors[key] = list
  }
  return errors
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = Number.parseInt(header, 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

const REASONS: readonly SessionExpiredReason[] = ['idle', 'absolute', 'invalid']

/** Convierte una respuesta HTTP fallida en un ApiError, sin confiar en su contenido. */
export function errorFromResponse(response: Response, body: ErrorBody): ApiError {
  const detail = typeof body?.detail === 'string' ? body.detail : ''
  const code = typeof body?.code === 'string' ? body.code : undefined
  const reasonValue = typeof body?.reason === 'string' ? body.reason : undefined
  const reason = REASONS.find((r) => r === reasonValue)
  const status = response.status

  if (status === 401) {
    return new ApiError({
      kind: 'unauthenticated',
      status,
      code: code ?? 'not_authenticated',
      reason,
      message: detail || 'No hay una sesión activa.',
    })
  }
  if (status === 403) {
    return new ApiError({
      kind: 'forbidden',
      status,
      code,
      isCsrfFailure: detail.startsWith('CSRF'),
      message: detail || 'No tienes permiso para realizar esta acción.',
    })
  }
  if (status === 400) {
    const fieldErrors = fieldErrorsFrom(body)
    const first = Object.values(fieldErrors)[0]?.[0]
    return new ApiError({
      kind: 'validation',
      status,
      fieldErrors,
      message: detail || first || 'Los datos enviados no son válidos.',
    })
  }
  if (status === 429) {
    return new ApiError({
      kind: 'throttled',
      status,
      retryAfterSeconds: parseRetryAfter(response.headers.get('Retry-After')),
      message: 'Demasiados intentos. Espera un momento antes de volver a intentarlo.',
    })
  }
  if (status >= 500) {
    return new ApiError({ kind: 'server', status, message: 'El servidor no está disponible.' })
  }
  return new ApiError({ kind: 'http', status, code, message: detail || `Error HTTP ${status}.` })
}
