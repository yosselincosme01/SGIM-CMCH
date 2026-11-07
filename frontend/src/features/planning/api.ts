/**
 * Endpoints de planificación (backend/apps/incidents, ADR 0004).
 *
 * El backend es la autoridad: comprueba en cada operación que el usuario sea
 * Planificador del área de la incidencia y que el técnico esté autorizado en ella.
 */
import { apiRequest, backgroundRequest } from '../../shared/api/client'
import type {
  CareUnitOption,
  IncidentDetail,
  Page,
  Person,
  PriorityLevel,
  SupportAreaOption,
} from '../incidents/api'

export interface PlanningOptions {
  areas: SupportAreaOption[]
  priorities: PriorityLevel[]
  counts: { unprioritized: number; unassigned: number; scheduled_today: number }
}

export interface PlanningItem {
  code: string
  status: string
  status_label: string
  care_unit: CareUnitOption
  support_area: SupportAreaOption
  description_excerpt: string
  created_by: Person
  created_at: string
  priority: PriorityLevel | null
  assignment: { id: number; technician: Person; scheduled_at: string } | null
  has_attachments: boolean
}

export interface Technician extends Person {
  active_assignments: number
  next_scheduled_at: string | null
}

export interface PlanningFilters {
  area?: string
  status?: string
  priority?: string
  scheduled_on?: string
  q?: string
  ordering?: string
  page?: number
}

const CODE = /^[A-Za-z0-9-]{3,20}$/

function incidentPath(code: string, suffix: string): string {
  if (!CODE.test(code)) throw new Error('Código de incidencia no válido.')
  return `/incidents/${encodeURIComponent(code)}/${suffix}`
}

export function planningQuery(filters: PlanningFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '' || (key === 'page' && value === 1)) continue
    params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function fetchPlanningOptions(signal?: AbortSignal, passive = false) {
  const request = passive ? backgroundRequest : apiRequest
  return request<PlanningOptions>('/incidents/planning/options/', { signal })
}

/** ``passive``: actualización automática (no cuenta como actividad del usuario). */
export function fetchPlanningInbox(filters: PlanningFilters, signal?: AbortSignal, passive = false) {
  const request = passive ? backgroundRequest : apiRequest
  return request<Page<PlanningItem>>(`/incidents/planning/${planningQuery(filters)}`, { signal })
}

export function fetchTechnicians(code: string, signal?: AbortSignal) {
  return apiRequest<{ results: Technician[] }>(incidentPath(code, 'technicians/'), { signal })
}

export function setPriority(code: string, priority: string, reason = '') {
  const body: Record<string, string> = { priority }
  if (reason.trim()) body.reason = reason.trim()
  return apiRequest<IncidentDetail>(incidentPath(code, 'priority/'), { method: 'PUT', body })
}

export interface ScheduleInput {
  priority: string
  technician: string
  /** Hora de Lima, "AAAA-MM-DDTHH:mm" (sin zona horaria). */
  scheduledAt: string
  notes: string
  reason: string
  /** Asignación vigente que el usuario estaba viendo; null en la primera programación. */
  expectedAssignment: number | null
}

/** Programa, reprograma o reasigna. Nunca envía estado ni autor. */
export function scheduleAttention(code: string, input: ScheduleInput) {
  const body: Record<string, unknown> = {
    priority: input.priority,
    technician: input.technician,
    scheduled_at: input.scheduledAt,
    expected_assignment: input.expectedAssignment,
  }
  if (input.notes.trim()) body.notes = input.notes.trim()
  if (input.reason.trim()) body.reason = input.reason.trim()
  return apiRequest<IncidentDetail>(incidentPath(code, 'planning/'), { method: 'POST', body })
}
