import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { server } from '../../test/server'
import { apiRequest, backgroundRequest } from './client'
import { readCsrfToken } from './csrf'
import { ApiError } from './errors'
import { activityEvents, unauthorizedEvents } from './events'

const unsubscribers: Array<() => void> = []

/** Espera que la petición falle y devuelve su error, tipado como ApiError. */
async function failure(request: Promise<unknown>): Promise<ApiError> {
  try {
    await request
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('Se esperaba que la petición fallara.')
}
afterEach(() => unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe()))

function spyOn<T>(channel: { subscribe: (fn: (payload: T) => void) => () => void }) {
  const listener = vi.fn()
  unsubscribers.push(channel.subscribe(listener))
  return listener
}

describe('cliente de API', () => {
  it('usa el proxy /api/v1 del mismo origen', async () => {
    backend.signIn(USERS.solicitante)
    await apiRequest('/auth/me/')

    expect(backend.requests[0].path).toBe('/api/v1/auth/me/')
  })

  it('rechaza rutas que no sean internas', async () => {
    await expect(apiRequest('//evil.example/x')).rejects.toThrow(/no válida/)
    await expect(apiRequest('https://evil.example/x')).rejects.toThrow(/no válida/)
  })

  describe('peticiones pasivas', () => {
    it('backgroundRequest envía X-SGIM-Passive: 1', async () => {
      backend.signIn(USERS.solicitante)
      await backgroundRequest('/auth/me/')

      expect(backend.requests[0].passive).toBe(true)
    })

    it('apiRequest no envía la cabecera pasiva', async () => {
      backend.signIn(USERS.solicitante)
      await apiRequest('/auth/me/')

      expect(backend.requests[0].passive).toBe(false)
    })

    it('solo las peticiones activas notifican actividad', async () => {
      backend.signIn(USERS.solicitante)
      const activity = spyOn(activityEvents)

      await backgroundRequest('/auth/me/')
      expect(activity).not.toHaveBeenCalled()

      await apiRequest('/auth/me/')
      expect(activity).toHaveBeenCalledTimes(1)
    })
  })

  describe('CSRF', () => {
    it('lee el token de la cookie csrftoken', () => {
      expect(readCsrfToken('a=1; csrftoken=abc123; b=2')).toBe('abc123')
      expect(readCsrfToken('a=1')).toBeNull()
    })

    it('envía X-CSRFToken en métodos que modifican datos', async () => {
      backend.signIn(USERS.solicitante)
      document.cookie = `csrftoken=${backend.csrfToken}; path=/`

      await apiRequest('/auth/logout/', { method: 'POST' })

      expect(backend.requests[0].csrfHeader).toBe('csrf-inicial')
    })

    it('no envía el token en peticiones GET', async () => {
      backend.signIn(USERS.solicitante)
      document.cookie = 'csrftoken=abc; path=/'

      await apiRequest('/auth/me/')

      expect(backend.requests[0].csrfHeader).toBeNull()
    })

    it('identifica un rechazo por CSRF (403)', async () => {
      backend.signIn(USERS.solicitante)
      const error = await failure(apiRequest('/auth/logout/', { method: 'POST' }))

      expect(error).toBeInstanceOf(ApiError)
      expect(error.kind).toBe('forbidden')
      expect(error.isCsrfFailure).toBe(true)
    })
  })

  describe('401 y 403', () => {
    it('distingue 401 (sin sesión) de 403 (sin permiso)', async () => {
      server.use(
        http.get('*/api/v1/forbidden/', () =>
          HttpResponse.json({ detail: 'No tiene permiso.' }, { status: 403 }),
        ),
      )
      const unauthenticated = await failure(apiRequest('/auth/me/'))
      const forbidden = await failure(apiRequest('/forbidden/'))

      expect(unauthenticated.kind).toBe('unauthenticated')
      expect(unauthenticated.code).toBe('not_authenticated')
      expect(forbidden.kind).toBe('forbidden')
      expect(forbidden.isCsrfFailure).toBe(false)
    })

    it('reconoce session_expired y su motivo', async () => {
      backend.signIn(USERS.solicitante)
      backend.expiredReason = 'absolute'

      const error = await failure(apiRequest('/auth/me/'))

      expect(error.isSessionExpired).toBe(true)
      expect(error.reason).toBe('absolute')
    })

    it('un 401 notifica el cierre de sesión global', async () => {
      const unauthorized = spyOn(unauthorizedEvents)
      await apiRequest('/auth/me/').catch(() => undefined)

      expect(unauthorized).toHaveBeenCalledTimes(1)
    })

    it('se puede desactivar la notificación (flujo de login)', async () => {
      const unauthorized = spyOn(unauthorizedEvents)
      await apiRequest('/auth/me/', { notifyUnauthorized: false }).catch(() => undefined)

      expect(unauthorized).not.toHaveBeenCalled()
    })
  })

  describe('errores', () => {
    it('convierte un fallo de red en un error tipado y no reintenta', async () => {
      backend.networkDown = true
      const error = await failure(apiRequest('/auth/me/'))

      expect(error.kind).toBe('network')
      expect(error.message).toBe('No se pudo conectar con el servidor.')
      expect(backend.requests).toHaveLength(1)
    })

    it('no expone el cuerpo de errores del servidor que no sean JSON', async () => {
      server.use(
        http.get('*/api/v1/boom/', () =>
          new HttpResponse('<html><script>alert(1)</script></html>', {
            status: 500,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
      )
      const error = await failure(apiRequest('/boom/'))

      expect(error.kind).toBe('server')
      expect(error.message).toBe('El servidor no está disponible.')
    })

    it('lee Retry-After en respuestas 429', async () => {
      backend.throttleRetryAfter = 42
      const error = await failure(apiRequest('/auth/login/', { method: 'POST', body: {} }))

      expect(error.kind).toBe('throttled')
      expect(error.retryAfterSeconds).toBe(42)
    })

    it('agota el tiempo de espera con un error claro', async () => {
      server.use(http.get('*/api/v1/slow/', () => new Promise(() => undefined)))
      const error = await failure(apiRequest('/slow/', { timeoutMs: 20 }))

      expect(error.kind).toBe('timeout')
    })
  })
})
