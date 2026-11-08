/**
 * Administración de cuentas operativas (backend/apps/administration, ADR 0007).
 * El backend impide crear Administradores, elevar privilegios o modificar cuentas
 * protegidas aunque la solicitud se manipule.
 */
import { apiRequest } from '../../shared/api/client'
import type { Page } from '../incidents/api'

export type ManagedRole = 'solicitante' | 'planificador' | 'personal_atencion'

export interface Membership {
  area: string
  area_name?: string
  can_plan: boolean
  can_be_assigned: boolean
}

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
