/**
 * Cliente HTTP centralizado y tipado para la API de SGIM-CMCH (/api/v1).
 *
 * - Usa el mismo origen (proxy /api de Vite en desarrollo): la cookie de sesión
 *   HttpOnly viaja sola; el frontend nunca la lee ni la guarda.
 * - Añade X-CSRFToken en métodos que modifican datos.
 * - `apiRequest`: peticiones originadas por el usuario. Si tienen éxito, el
 *   servidor renueva la inactividad de la sesión.
 * - `backgroundRequest`: peticiones automáticas (polling, restauración, CSRF).
 *   Envían `X-SGIM-Passive: 1` y NUNCA renuevan la inactividad.
 * - No reintenta nunca automáticamente.
 *
 * Ver docs/sesiones.md.
 */
import { CSRF_HEADER_NAME, readCsrfToken } from './csrf'
import { ApiError, errorFromResponse } from './errors'
import { activityEvents, unauthorizedEvents } from './events'

export const API_BASE_PATH = '/api/v1'
export const PASSIVE_HEADER_NAME = 'X-SGIM-Passive'
export const DEFAULT_TIMEOUT_MS = 15_000

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
  /**
   * Si es false, un 401 no dispara el cierre de sesión global. Se usa en el login,
   * donde un error forma parte del flujo normal.
   */
  notifyUnauthorized?: boolean
}

interface InternalOptions extends RequestOptions {
  passive: boolean
}

function buildUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`Ruta de API no válida: ${path}`)
  }
  return new URL(`${API_BASE_PATH}${path}`, window.location.origin).toString()
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('application/json')) return null
  try {
    const data: unknown = await response.json()
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

async function send<T>(path: string, options: InternalOptions): Promise<T> {
  const url = buildUrl(path) // valida la ruta antes de cualquier petición
  const method = options.method ?? 'GET'
  const headers = new Headers({ Accept: 'application/json' })
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.passive) headers.set(PASSIVE_HEADER_NAME, '1')
  if (UNSAFE_METHODS.has(method)) {
    const token = readCsrfToken()
    if (token) headers.set(CSRF_HEADER_NAME, token)
  }

  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
    })
  } catch (cause) {
    if (options.signal?.aborted) throw cause // cancelación pedida por quien llama
    const timedOut = timeout.signal.aborted
    throw new ApiError({
      kind: timedOut ? 'timeout' : 'network',
      status: 0,
      message: timedOut
        ? 'El servidor tardó demasiado en responder.'
        : 'No se pudo conectar con el servidor.',
    })
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const error = errorFromResponse(response, await readJson(response))
    if (error.kind === 'unauthenticated' && options.notifyUnauthorized !== false) {
      unauthorizedEvents.emit(error)
    }
    throw error
  }

  if (!options.passive) activityEvents.emit()
  if (response.status === 204) return undefined as T
  return (await readJson(response)) as T
}

/** Petición originada por una acción del usuario. Renueva la inactividad si tiene éxito. */
export function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return send<T>(path, { ...options, passive: false })
}

/** Petición automática. Nunca renueva la inactividad de la sesión. */
export function backgroundRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return send<T>(path, { ...options, passive: true })
}
