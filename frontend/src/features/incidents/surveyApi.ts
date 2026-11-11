/**
 * Encuesta de satisfacción del solicitante (ADR 0012): ``/incidents/<código>/survey/``.
 * Solo la usa quien registró la incidencia; el backend valida identidad, cierre vigente
 * y que no exista una respuesta previa.
 */
import { apiRequest, backgroundRequest } from '../../shared/api/client'

export interface SurveyAnswer {
  /** Cierre técnico evaluado (intervención "Solucionado"). */
  closure: number
  closed_at: string
  rating: number
  comment: string
  created_at: string
}

export interface SurveyState {
  code: string
  /** Cierre vigente pendiente de evaluar; ``null`` si no hay ninguno. */
  pending: { closure: number; closed_at: string } | null
  /** Evaluaciones anteriores del solicitante, de la más reciente a la más antigua. */
  history: SurveyAnswer[]
}

const CODE = /^[A-Za-z0-9-]{3,20}$/

function surveyPath(code: string): string {
  if (!CODE.test(code)) throw new Error('Código de incidencia no válido.')
  return `/incidents/${encodeURIComponent(code)}/survey/`
}

export function fetchSurvey(code: string, signal?: AbortSignal) {
  return apiRequest<SurveyState>(surveyPath(code), { signal })
}

export function submitSurvey(code: string, answer: { closure: number; rating: number; comment: string }) {
  return apiRequest<SurveyState>(surveyPath(code), { method: 'POST', body: answer })
}

/** Recordatorio al iniciar sesión (ADR 0012): una vez por sesión, marcado en el servidor. */
export interface SurveyReminder {
  show: boolean
  total: number
  /** Hasta 5 tickets, del cierre más reciente al más antiguo. */
  items: { code: string; closed_at: string }[]
}

/** Consulta automática: no cuenta como actividad del usuario. */
export function fetchSurveyReminder(signal?: AbortSignal) {
  return backgroundRequest<SurveyReminder>('/incidents/survey-reminder/', { signal })
}

/** Marca el recordatorio como mostrado en esta sesión. No registra ninguna respuesta. */
export function markSurveyReminderShown() {
  return backgroundRequest<void>('/incidents/survey-reminder/', { method: 'POST' })
}
