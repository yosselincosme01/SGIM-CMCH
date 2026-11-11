/** Endpoints de incidencias (backend/apps/incidents). */
import { apiRequest } from '../../shared/api/client'
import {
  type EquipmentMode,
  type EquipmentQrStatus,
  type NoQrReason,
  type QrCaptureMethod,
  statusFor,
} from './equipment'
import type { SurveyAnswer } from './surveyApi'

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
  /** Mis incidencias: cierre vigente pendiente de evaluar (ADR 0012). */
  survey_pending?: boolean
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

export interface Verification {
  id: number
  result: 'conforming' | 'not_conforming'
  result_label: string
  observations: string
  verified_by: Person
  created_at: string
}

export type InterventionResult = 'solved' | 'in_progress' | 'not_solved'

export interface Intervention {
  id: number
  assignment: number
  technician: Person
  result: InterventionResult
  result_label: string
  diagnosis: string
  actions_taken: string
  used_parts: boolean
  used_parts_detail: string
  parts_required: boolean
  parts_required_detail: string
  unresolved_reason: string
  observations: string
  /** Ausente en la consulta del Administrador, que no recibe evidencia (ADR 0009). */
  photos?: IncidentAttachment[]
  /** Solo en la consulta del Administrador: cuántas fotografías tiene. */
  photo_count?: number
  is_closure: boolean
  verification: Verification | null
  created_at: string
}

export interface Closure {
  intervention: number
  closed_by: Person
  closed_at: string
  pending_verification: boolean
  verification: Verification | null
}

/**
 * Acciones disponibles para quien consulta, calculadas por el backend según sus
 * funciones en el área (ADR 0008). La interfaz solo las refleja.
 */
export interface IncidentPermissions {
  can_plan: boolean
  can_intervene: boolean
  can_verify: boolean
  can_reopen: boolean
  /** Tiene la función de verificar, pero ejecutó la intervención de cierre. */
  verification_blocked?: 'own_intervention' | null
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
  /** Historial técnico y cierre vigente (solo personal del área). */
  interventions?: Intervention[]
  closure?: Closure | null
  permissions?: IncidentPermissions
  /**
   * Evaluaciones del solicitante (ADR 0012). Solo llegan con contenido a quien planifica
   * o verifica en el área, y al Administrador en la consulta global.
   */
  surveys?: SurveyAnswer[]
  /** Vista del solicitante: fecha del cierre técnico vigente. */
  closed_at?: string | null
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
  /** Opción principal: escanear/escribir el QR, o "No tiene QR / No aplica". */
  equipmentMode: EquipmentMode | ''
  /** Motivo cuando no hay un QR utilizable. */
  noQrReason: NoQrReason | ''
  qrCode: string
  /** `scan` solo si el contenido lo leyó la cámara; si el usuario lo edita, `manual`. */
  qrCaptureMethod: QrCaptureMethod
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
  const status = statusFor(data.equipmentMode, data.noQrReason)
  form.append('equipment_qr_status', status)
  // El contenido y la forma de captura solo se envían con un QR legible.
  if (status === 'qr_readable') {
    form.append('qr_code', data.qrCode.trim())
    form.append('qr_capture_method', data.qrCaptureMethod)
  }
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
