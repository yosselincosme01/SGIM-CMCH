/** Endpoints de incidencias (backend/apps/incidents). */
import { apiRequest } from '../../shared/api/client'

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

export interface IncidentEvent {
  event_type: string
  label: string
  actor: string
  created_at: string
}

export interface IncidentDetail extends Omit<IncidentSummary, 'has_attachments'> {
  description: string
  prior_actions: string
  asset_reference: string
  created_by: { username: string; full_name: string }
  attachments: IncidentAttachment[]
  events: IncidentEvent[]
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
  assetReference: string
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
  if (data.assetReference.trim()) form.append('asset_reference', data.assetReference.trim())
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
