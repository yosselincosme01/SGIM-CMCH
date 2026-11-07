/** Endpoints de incidencias (backend/apps/incidents). */
import { apiRequest } from '../../shared/api/client'
import type { EquipmentQrStatus } from './equipment'

export interface CareUnitOption {
  code: string
  name: string
  is_demo: boolean
}

export interface SupportAreaOption {
  code: string
  name: string
}

export interface IncidentOptions {
  care_units: CareUnitOption[]
  support_areas: SupportAreaOption[]
}

export interface IncidentSummary {
  code: string
  status: string
  status_label: string
  care_unit: CareUnitOption
  support_area: SupportAreaOption
  created_at: string
  has_attachments: boolean
}

export interface IncidentAttachment {
  id: number
  original_name: string
  content_type: string
  size: number
  width: number
  height: number
  url: string
}

export interface Person {
  username: string
  full_name: string
}

export interface PriorityLevel {
  code: string
  name: string
  order: number
  description: string
  /** Niveles pendientes de validación institucional. */
  is_provisional: boolean
}

export interface IncidentEvent {
  event_type: string
  label: string
  actor: string
  created_at: string
  /** Solo para el personal del área: valores anteriores y nuevos del cambio. */
  from_status?: string
  to_status?: string
  details?: Record<string, unknown>
}

export interface CurrentAssignment {
  id: number
  technician: Person
  assigned_by: Person
  scheduled_at: string
  notes: string
  created_at: string
}

export interface IncidentDetail extends Omit<IncidentSummary, 'has_attachments'> {
  description: string
  prior_actions: string
  /** Identificación del equipo. ``unspecified`` solo en incidencias anteriores. */
  equipment_qr_status: EquipmentQrStatus | 'unspecified'
  equipment_qr_status_label: string
  /** Texto leído del QR. Se muestra como texto: nunca se abre como enlace. */
  qr_code: string
  created_by: Person
  attachments: IncidentAttachment[]
  events: IncidentEvent[]
  /** Vista del solicitante: fecha estimada de atención, si ya se programó. */
  scheduled_at?: string | null
  /** Vista del personal del área. */
  priority?: PriorityLevel | null
  assignment?: CurrentAssignment | null
  permissions?: { can_plan: boolean }
}

export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface NewIncident {
  careUnit: string
  supportArea: string
  description: string
  priorActions: string
  equipmentQrStatus: EquipmentQrStatus | ''
  qrCode: string
  photo: File | null
}

export function fetchIncidentOptions(signal?: AbortSignal): Promise<IncidentOptions> {
  return apiRequest<IncidentOptions>('/incidents/options/', { signal })
}

/** Registro: multipart (la fotografía es opcional). Nunca envía estado ni autor. */
export function createIncident(data: NewIncident): Promise<IncidentDetail> {
  const form = new FormData()
  form.append('care_unit', data.careUnit)
  form.append('support_area', data.supportArea)
  form.append('description', data.description.trim())
  if (data.priorActions.trim()) form.append('prior_actions', data.priorActions.trim())
  form.append('equipment_qr_status', data.equipmentQrStatus)
  // El contenido solo se envía con un QR legible; la forma de captura la fija el servidor.
  if (data.equipmentQrStatus === 'qr_readable') form.append('qr_code', data.qrCode.trim())
  if (data.photo) form.append('photo', data.photo)
  return apiRequest<IncidentDetail>('/incidents/', { method: 'POST', body: form })
}

export function fetchMyIncidents(page: number, signal?: AbortSignal): Promise<Page<IncidentSummary>> {
  const query = page > 1 ? `?scope=mine&page=${page}` : '?scope=mine'
  return apiRequest<Page<IncidentSummary>>(`/incidents/${query}`, { signal })
}

export function fetchIncident(code: string, signal?: AbortSignal): Promise<IncidentDetail> {
  if (!/^[A-Za-z0-9-]{3,20}$/.test(code)) {
    return Promise.reject(new Error('Código de incidencia no válido.'))
  }
  return apiRequest<IncidentDetail>(`/incidents/${encodeURIComponent(code)}/`, { signal })
}
