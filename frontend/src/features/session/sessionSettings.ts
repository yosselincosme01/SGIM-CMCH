import { createContext, useContext } from 'react'

/**
 * Parámetros del monitor de sesión. Los límites reales (8 h absolutas y 30 min de
 * inactividad) los define y aplica el backend; aquí solo se decide cuándo consultar
 * y cuándo avisar.
 */
export interface SessionSettings {
  /** Cada cuánto se consulta GET /auth/session/ (petición pasiva). */
  pollIntervalMs: number
  /** Segundos antes del vencimiento en que aparece el aviso. */
  warningSeconds: number
  /** Frecuencia de actualización de la cuenta regresiva. */
  tickMs: number
  /** Espera mínima entre comprobaciones cuando la cuenta llega a cero. */
  recheckMs: number
  /** Agrupa varias peticiones activas seguidas en una sola consulta de estado. */
  activityDebounceMs: number
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  pollIntervalMs: 60_000,
  warningSeconds: 120,
  tickMs: 1_000,
  recheckMs: 5_000,
  activityDebounceMs: 2_000,
}

export const SessionSettingsContext = createContext<SessionSettings>(DEFAULT_SESSION_SETTINGS)

export function useSessionSettings(): SessionSettings {
  return useContext(SessionSettingsContext)
}

export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}
