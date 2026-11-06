import { createContext } from 'react'

import type { SessionExpiredReason } from '../../shared/api/errors'
import type { Credentials, CurrentUser } from './api'

/** Motivo por el que se muestra la pantalla de inicio de sesión. */
export type AuthNotice =
  | { kind: 'session-expired'; reason?: SessionExpiredReason }
  | { kind: 'session-ended' } // 401 sin sesión mientras se usaba la aplicación
  | { kind: 'signed-out' }
  | { kind: 'signed-out-elsewhere' } // cierre de sesión en otra pestaña
  | { kind: 'signed-out-unconfirmed' } // no se pudo confirmar el cierre en el servidor

export type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: CurrentUser }
  | { status: 'anonymous'; notice?: AuthNotice }
  | { status: 'error'; message: string }

export interface AuthContextValue {
  state: AuthState
  login: (credentials: Credentials) => Promise<CurrentUser>
  logout: () => Promise<void>
  /** Marca la sesión como terminada (p. ej., el servidor confirmó que expiró). */
  endSession: (notice: AuthNotice) => void
  clearNotice: () => void
  retry: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
