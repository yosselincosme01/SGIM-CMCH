/**
 * Endpoints de atención, verificación y reapertura (backend/apps/incidents, ADR 0006).
 * El backend vuelve a comprobar en cada operación quién puede hacerla y en qué estado.
 */
import { apiRequest, backgroundRequest } from '../../shared/api/client'
import type { IncidentDetail, InterventionResult, Page } from '../incidents/api'
import { type PlanningItem, planningQuery } from '../planning/api'

export interface AttentionFilters {
  status?: string
  scheduled_on?: string
  page?: number
}

const CODE = /^[A-Za-z0-9-]{3,20}$/

function incidentPath(code: string, suffix: string): string {
  if (!CODE.test(code)) throw new Error('Código de incidencia no válido.')
  return `/incidents/${encodeURIComponent(code)}/${suffix}`
}

export function fetchAttentionInbox(
  filters: AttentionFilters,
  signal?: AbortSignal,
  passive = false,
) {
  const request = passive ? backgroundRequest : apiRequest
  return request<Page<PlanningItem>>(`/incidents/attention/${planningQuery(filters)}`, { signal })
}

export interface InterventionInput {
  /** Asignación vigente que el técnico estaba viendo (control de concurrencia). */
  assignment: number
  diagnosis: string
  actionsTaken: string
  result: InterventionResult | ''
  usedParts: boolean | null
  usedPartsDetail: string
  partsRequired: boolean | null
  partsRequiredDetail: string
  unresolvedReason: string
  observations: string
  photos: File[]
}

/** Multipart con las fotos. Nunca envía estado, técnico ni fechas: los fija el servidor. */
export function registerIntervention(code: string, input: InterventionInput) {
  const form = new FormData()
  form.append('assignment', String(input.assignment))
  form.append('diagnosis', input.diagnosis.trim())
  form.append('actions_taken', input.actionsTaken.trim())
  form.append('result', input.result)
  if (input.usedParts !== null) form.append('used_parts', String(input.usedParts))
  if (input.usedParts) form.append('used_parts_detail', input.usedPartsDetail.trim())
  if (input.partsRequired !== null) form.append('parts_required', String(input.partsRequired))
  if (input.partsRequired) form.append('parts_required_detail', input.partsRequiredDetail.trim())
  if (input.result && input.result !== 'solved') {
    form.append('unresolved_reason', input.unresolvedReason.trim())
  }
  if (input.observations.trim()) form.append('observations', input.observations.trim())
  for (const photo of input.photos) form.append('photos', photo)
  return apiRequest<IncidentDetail>(incidentPath(code, 'interventions/'), {
    method: 'POST',
    body: form,
  })
}

export function verifyClosure(code: string, result: string, observations: string) {
  const body: Record<string, string> = { result }
  if (observations.trim()) body.observations = observations.trim()
  return apiRequest<IncidentDetail>(incidentPath(code, 'verification/'), { method: 'POST', body })
}

export function reopenIncident(code: string, reason: string) {
  return apiRequest<IncidentDetail>(incidentPath(code, 'reopen/'), {
    method: 'POST',
    body: { reason: reason.trim() },
  })
}
