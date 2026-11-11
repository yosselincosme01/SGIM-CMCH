/**
 * Resumen del Inicio (ADR 0010): ``GET /api/v1/incidents/summary/``. Lo calcula el
 * backend con las capacidades efectivas y las áreas autorizadas de la persona. Las
 * secciones sin capacidad llegan como ``null``.
 */
import { apiRequest, backgroundRequest } from '../../shared/api/client'

export type TodoAction = 'attend' | 'verify' | 'plan' | 'follow_up'

export interface TodoItem {
  code: string
  status: string
  status_label: string
  area: string
  area_name: string
  care_unit: string
  action: TodoAction
  /** Qué fecha se muestra: "Programada", "Cerrada" o "Registrada". */
  date_label: string
  date: string | null
}

export interface HomeSummary {
  own: { total: number; by_status: { key: string; label: string; total: number }[] } | null
  attention: { assigned: number } | null
  planning: { to_schedule: number; follow_up: number } | null
  verification: { pending: number } | null
  /** Encuestas de satisfacción: Etapa 3. Siempre ``null`` por ahora. */
  surveys: { pending: number } | null
  todo: { total: number; items: TodoItem[] }
}

/** ``passive``: actualización automática (no cuenta como actividad del usuario). */
export function fetchHomeSummary(signal?: AbortSignal, passive = false) {
  const request = passive ? backgroundRequest : apiRequest
  return request<HomeSummary>('/incidents/summary/', { signal })
}
