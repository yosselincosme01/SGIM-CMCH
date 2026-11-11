import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

import { Button } from '../../shared/ui/Button'
import { FullPageStatus } from '../../shared/ui/FullPageStatus'
import { PATHS } from '../../shared/paths'
import { canAccess, type Feature } from '../navigation/access'
import { useAuth } from './useAuth'

export interface LoginRedirectState {
  from?: string
}

/** Protege las rutas hijas: sin sesión, redirige al login recordando el destino. */
export function RequireAuth() {
  const { state, retry } = useAuth()
  const location = useLocation()

  if (state.status === 'loading') {
    return <FullPageStatus title="Verificando sesión…" loading />
  }
  if (state.status === 'error') {
    return (
      <FullPageStatus title="No se pudo conectar con el servidor">
        <p>{state.message} Revisa tu conexión e inténtalo de nuevo.</p>
        <Button onClick={retry}>Reintentar</Button>
      </FullPageStatus>
    )
  }
  if (state.status === 'anonymous') {
    const from = `${location.pathname}${location.search}`
    return <Navigate to="/login" replace state={{ from } satisfies LoginRedirectState} />
  }
  return <Outlet />
}

/**
 * Protege una funcionalidad según los permisos efectivos del usuario (ADR 0009). Es
 * solo navegación: la autorización real la aplica el backend en cada endpoint.
 */
export function RequireAccess({ feature, children }: { feature: Feature; children: ReactNode }) {
  const { state } = useAuth()
  if (state.status !== 'authenticated') return null
  if (!canAccess(state.user, feature)) return <Navigate to={PATHS.forbidden} replace />
  return <>{children}</>
}
