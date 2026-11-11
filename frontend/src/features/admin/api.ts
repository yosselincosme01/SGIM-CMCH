/**
 * Administración de cuentas operativas (backend/apps/administration, ADR 0007).
 * El backend impide crear Administradores, elevar privilegios o modificar cuentas
 * protegidas aunque la solicitud se manipule.
 */
import { apiRequest } from '../../shared/api/client'
import type { IncidentDetail, Page } from '../incidents/api'
import type { PlanningItem } from '../planning/api'

export type ManagedRole = 'solicitante' | 'planificador' | 'personal_atencion'

/**
 * Funciones de una persona en un área (ADR 0008). Son independientes entre sí:
 * planificar no implica verificar, ni al revés.
 */
export interface Membership {
  area: string
  area_name?: string
  /** Planificar atenciones (requiere el rol Planificador). */
  can_plan: boolean
  /** Recibir asignaciones y registrar atenciones (requiere Personal de Atención). */
  can_be_assigned: boolean
  /** Verificar conformidad de los cierres técnicos (requiere el rol Planificador). */
  can_verify: boolean
}

export type AreaFunction = 'can_plan' | 'can_be_assigned' | 'can_verify'

export interface AdminUser {
  id: number
  username: string
  first_name: string
  last_name: string
  full_name: string
  email: string
  is_active: boolean
  last_login: string | null
  date_joined: string
  roles: string[]
  memberships: Membership[]
  /** Cuenta administrativa, de superusuario o staff: no se modifica desde aquí. */
  is_protected: boolean
  open_assignment_areas: string[]
}

export interface AdminOptions {
  roles: { code: ManagedRole; label: string }[]
  areas: { code: string; name: string }[]
  /** Acciones registradas en la auditoría (ADR 0009). */
  audit_actions?: { code: string; label: string }[]
}

export interface UserFilters {
  q?: string
  role?: string
  active?: string
  area?: string
  page?: number
}

export function fetchAdminOptions(signal?: AbortSignal) {
  return apiRequest<AdminOptions>('/admin/options/', { signal })
}

export function fetchUsers(filters: UserFilters, signal?: AbortSignal) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && !(key === 'page' && value === 1)) {
      params.set(key, String(value))
    }
  }
  const text = params.toString()
  return apiRequest<Page<AdminUser>>(`/admin/users/${text ? `?${text}` : ''}`, { signal })
}

export function fetchUser(id: number, signal?: AbortSignal) {
  return apiRequest<AdminUser>(`/admin/users/${id}/`, { signal })
}

export interface NewUser {
  username: string
  first_name: string
  last_name: string
  email: string
  password: string
  password_confirm: string
  roles: ManagedRole[]
  memberships: Membership[]
}

export function createUser(data: NewUser) {
  return apiRequest<AdminUser>('/admin/users/', { method: 'POST', body: data })
}

export function updateUser(
  id: number,
  data: Partial<Pick<NewUser, 'first_name' | 'last_name' | 'email' | 'roles' | 'memberships'>>,
) {
  return apiRequest<AdminUser>(`/admin/users/${id}/`, { method: 'PATCH', body: data })
}

export function setUserActive(id: number, active: boolean) {
  return apiRequest<AdminUser>(`/admin/users/${id}/activation/`, {
    method: 'POST',
    body: { active },
  })
}

export function resetUserPassword(id: number, password: string, passwordConfirm: string) {
  return apiRequest<void>(`/admin/users/${id}/password/`, {
    method: 'POST',
    body: { password, password_confirm: passwordConfirm },
  })
}

function query(filters: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '' && !(key === 'page' && value === 1)) {
      params.set(key, String(value))
    }
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

// --- Consulta global de incidencias (solo lectura, sin evidencia; ADR 0009) ----------

export interface GlobalIncidentFilters {
  area?: string
  status?: string
  priority?: string
  q?: string
  /** Fecha de registro (AAAA-MM-DD, hora de Lima). */
  date_from?: string
  date_to?: string
  page?: number
}

export function fetchGlobalIncidents(filters: GlobalIncidentFilters, signal?: AbortSignal) {
  return apiRequest<Page<PlanningItem>>(`/admin/incidents/${query(filters)}`, { signal })
}

/** Detalle sin ``attachments`` ni ``permissions``: solo el número de fotografías. */
export type GlobalIncidentDetail = Omit<IncidentDetail, 'attachments' | 'permissions'> & {
  attachment_count: number
}

const CODE = /^[A-Za-z0-9-]{3,20}$/

export function fetchGlobalIncident(code: string, signal?: AbortSignal) {
  if (!CODE.test(code)) throw new Error('Código de incidencia no válido.')
  return apiRequest<GlobalIncidentDetail>(`/admin/incidents/${encodeURIComponent(code)}/`, {
    signal,
  })
}

// --- Auditoría ---------------------------------------------------------------------

export interface AuditEntry {
  id: number
  action: string
  action_label: string
  actor: string
  target_user: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface AuditFilters {
  action?: string
  page?: number
}

export function fetchAudit(filters: AuditFilters, signal?: AbortSignal) {
  return apiRequest<Page<AuditEntry>>(`/admin/audit/${query(filters)}`, { signal })
}
