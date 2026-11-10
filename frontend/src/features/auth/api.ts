/**
 * Endpoints de autenticación del backend (docs/adr/0002-autenticacion-y-roles.md).
 * El frontend no crea endpoints propios: solo consume los existentes.
 */
import { apiRequest, backgroundRequest } from '../../shared/api/client'

export type BackendRole = 'administrador' | 'solicitante' | 'planificador' | 'personal_atencion'

export interface CurrentUser {
  id: number
  username: string
  first_name: string
  last_name: string
  full_name: string
  email: string
  roles: string[]
  /**
   * Funciones efectivas en alguna área (ADR 0008). Solo adaptan la interfaz: el
   * backend valida cada acción con el área concreta.
   */
  capabilities?: {
    can_plan: boolean
    can_attend: boolean
    can_verify: boolean
  }
  /** Funciones efectivas por área activa (ADR 0009). */
  area_functions?: AreaFunction[]
}

export interface AreaFunction {
  area: string
  area_name: string
  can_plan: boolean
  can_attend: boolean
  can_verify: boolean
}

export interface SessionStatus {
  server_time: string
  expires_at: string
  expires_in: number
  absolute_expires_at: string
  idle_expires_at: string
  absolute_timeout: number
  idle_timeout: number
}

export interface Credentials {
  username: string
  password: string
}

/** Pide la cookie CSRF. Es pasiva: no cuenta como actividad. */
export function fetchCsrfCookie(): Promise<void> {
  return backgroundRequest<void>('/auth/csrf/')
}

/**
 * Inicia sesión. Antes obtiene siempre un token CSRF nuevo (no es un reintento:
 * es parte del flujo). Un error NUNCA provoca un reintento automático.
 */
export async function login(credentials: Credentials): Promise<CurrentUser> {
  await fetchCsrfCookie()
  return apiRequest<CurrentUser>('/auth/login/', {
    method: 'POST',
    body: credentials,
    notifyUnauthorized: false,
  })
}

export function logout(): Promise<void> {
  return apiRequest<void>('/auth/logout/', { method: 'POST', notifyUnauthorized: false })
}

/**
 * Usuario actual.
 * - `passive: true` al restaurar la sesión al cargar la página (no es una acción del usuario).
 * - `passive: false` cuando el usuario pide explícitamente seguir conectado.
 */
export function fetchCurrentUser(
  { passive }: { passive: boolean },
  signal?: AbortSignal,
): Promise<CurrentUser> {
  const request = passive ? backgroundRequest : apiRequest
  return request<CurrentUser>('/auth/me/', { signal })
}

/** Estado de la sesión. Siempre pasiva (el servidor además la trata como pasiva). */
export function fetchSessionStatus(signal?: AbortSignal): Promise<SessionStatus> {
  return backgroundRequest<SessionStatus>('/auth/session/', { signal })
}
