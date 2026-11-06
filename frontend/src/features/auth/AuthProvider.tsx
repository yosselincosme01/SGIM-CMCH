/**
 * Estado de autenticación de la aplicación.
 *
 * - Al cargar, restaura la sesión con GET /auth/me/ de forma PASIVA: recargar o
 *   reabrir una pestaña no cuenta como actividad.
 * - Nada se guarda en localStorage ni sessionStorage: el estado vive en memoria y
 *   la sesión real es la cookie HttpOnly que gestiona Django.
 * - Cualquier 401 de la API cierra la sesión local de inmediato (el contenido
 *   protegido se desmonta) y se informa el motivo en la pantalla de login.
 * - El cierre de sesión se comunica a las demás pestañas abiertas.
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { isApiError } from '../../shared/api/errors'
import { unauthorizedEvents } from '../../shared/api/events'
import * as authApi from './api'
import { AuthContext, type AuthContextValue, type AuthNotice, type AuthState } from './authContext'

const CHANNEL_NAME = 'sgim-auth'
type ChannelMessage = { type: 'signed-out' }

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const channelRef = useRef<BroadcastChannel | null>(null)

  // Restauración de la sesión al cargar (pasiva).
  useEffect(() => {
    const controller = new AbortController()
    authApi
      .fetchCurrentUser({ passive: true }, controller.signal)
      .then((user) => setState({ status: 'authenticated', user }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (isApiError(error) && error.kind === 'unauthenticated') {
          setState({
            status: 'anonymous',
            notice: error.isSessionExpired
              ? { kind: 'session-expired', reason: error.reason }
              : undefined,
          })
          return
        }
        setState({
          status: 'error',
          message: isApiError(error) ? error.message : 'No se pudo verificar la sesión.',
        })
      })
    return () => controller.abort()
  }, [attempt])

  const endSession = useCallback((notice: AuthNotice) => {
    setState({ status: 'anonymous', notice })
  }, [])

  // Cualquier 401 durante el uso de la aplicación termina la sesión local.
  useEffect(
    () =>
      unauthorizedEvents.subscribe((error) => {
        setState((current) =>
          current.status === 'authenticated'
            ? {
                status: 'anonymous',
                notice: error.isSessionExpired
                  ? { kind: 'session-expired', reason: error.reason }
                  : { kind: 'session-ended' },
              }
            : current,
        )
      }),
    [],
  )

  // Cierre de sesión en otra pestaña.
  useEffect(() => {
    const channel = openChannel()
    channelRef.current = channel
    if (!channel) return
    channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
      if (event.data?.type === 'signed-out') {
        setState((current) =>
          current.status === 'authenticated'
            ? { status: 'anonymous', notice: { kind: 'signed-out-elsewhere' } }
            : current,
        )
      }
    }
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [])

  const login = useCallback(async (credentials: authApi.Credentials) => {
    const user = await authApi.login(credentials)
    setState({ status: 'authenticated', user })
    return user
  }, [])

  const logout = useCallback(async () => {
    let notice: AuthNotice = { kind: 'signed-out' }
    try {
      await authApi.logout()
    } catch (error) {
      // 401: la sesión ya no existía en el servidor; el resultado es el mismo.
      if (!(isApiError(error) && error.kind === 'unauthenticated')) {
        notice = { kind: 'signed-out-unconfirmed' }
      }
    }
    // El estado local se borra siempre, aunque el servidor no responda.
    setState({ status: 'anonymous', notice })
    channelRef.current?.postMessage({ type: 'signed-out' } satisfies ChannelMessage)
  }, [])

  const clearNotice = useCallback(() => {
    setState((current) => (current.status === 'anonymous' ? { status: 'anonymous' } : current))
  }, [])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((value) => value + 1)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ state, login, logout, endSession, clearNotice, retry }),
    [state, login, logout, endSession, clearNotice, retry],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
