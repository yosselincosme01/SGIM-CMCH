import { useContext } from 'react'

import { AuthContext, type AuthContextValue } from './authContext'

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth debe usarse dentro de <AuthProvider>.')
  return value
}

/** Usuario autenticado. Solo debe usarse dentro de rutas protegidas. */
export function useCurrentUser() {
  const { state } = useAuth()
  if (state.status !== 'authenticated') {
    throw new Error('useCurrentUser requiere una sesión autenticada.')
  }
  return state.user
}
