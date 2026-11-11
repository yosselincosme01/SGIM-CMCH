/**
 * Encuesta de satisfacción simulada (ADR 0012). Reproduce las reglas del backend que usa
 * la interfaz: solo el solicitante, solo el cierre vigente, una respuesta por cierre y
 * calificación de 1 a 5. Datos ficticios.
 */
import { http, HttpResponse } from 'msw'

import type { SurveyState } from '../features/incidents/surveyApi'
import { backend } from './fakeBackend'
import { incidentsBackend } from './fakeIncidents'

const API = '*/api/v1'

export interface SurveyRequest {
  body: unknown
  csrfHeader: string | null
}

interface SurveyBackendState {
  states: Record<string, Omit<SurveyState, 'code'>>
  /** Sesiones (``backend.sessionId``) en las que ya se mostró el recordatorio. */
  reminderShownIn: number[]
  reminderRequests: { method: string; passive: boolean }[]
  requests: SurveyRequest[]
  /** Respuesta forzada para el próximo POST (simula errores del servidor). */
  nextError: { status: number; body: Record<string, unknown> } | null
}

function initial(): SurveyBackendState {
  return { states: {}, requests: [], nextError: null, reminderShownIn: [], reminderRequests: [] }
}

export const surveyBackend: SurveyBackendState & {
  reset: () => void
  /** Deja pendiente de evaluar el cierre vigente de la incidencia. */
  pending: (code: string, closure?: number) => void
} = {
  ...initial(),
  reset() {
    Object.assign(surveyBackend, initial())
  },
  pending(code, closure = 41) {
    const current = surveyBackend.states[code] ?? { pending: null, history: [] }
    surveyBackend.states[code] = {
      ...current,
      pending: { closure, closed_at: '2026-11-08T10:00:00-05:00' },
    }
  },
}

function ownIncident(code: string) {
  const user = backend.sessionUser
  return incidentsBackend.incidents.find(
    (item) => item.code === code.toUpperCase() && item.owner === user?.username,
  )
}

function stateOf(code: string): SurveyState {
  const key = code.toUpperCase()
  return { code: key, ...(surveyBackend.states[key] ?? { pending: null, history: [] }) }
}

/** Encuestas pendientes de la persona en sesión: cierres vigentes sin respuesta. */
function pendingFor(username: string) {
  return incidentsBackend.incidents
    .filter((item) => item.owner === username && surveyBackend.states[item.code]?.pending)
    .map((item) => ({ code: item.code, closed_at: surveyBackend.states[item.code]!.pending!.closed_at }))
}

const NON_OPERATIONAL = (roles: readonly string[]) =>
  !roles.some((role) => ['solicitante', 'planificador', 'personal_atencion'].includes(role))

export const surveyHandlers = [
  http.get(`${API}/incidents/survey-reminder/`, ({ request }) => {
    const user = backend.sessionUser
    if (!user) return HttpResponse.json({ detail: 'Sin sesión.' }, { status: 401 })
    surveyBackend.reminderRequests.push({ method: 'GET', passive: request.headers.get('X-SGIM-Passive') === '1' })
    const pending = NON_OPERATIONAL(user.roles) ? [] : pendingFor(user.username)
    return HttpResponse.json({
      show: pending.length > 0 && !surveyBackend.reminderShownIn.includes(backend.sessionId),
      total: pending.length,
      items: pending.slice(0, 5),
    })
  }),

  http.post(`${API}/incidents/survey-reminder/`, ({ request }) => {
    if (!backend.sessionUser) return HttpResponse.json({ detail: 'Sin sesión.' }, { status: 401 })
    surveyBackend.reminderRequests.push({ method: 'POST', passive: request.headers.get('X-SGIM-Passive') === '1' })
    if (request.headers.get('X-CSRFToken') !== backend.csrfToken) {
      return HttpResponse.json({ detail: 'CSRF Failed.' }, { status: 403 })
    }
    surveyBackend.reminderShownIn.push(backend.sessionId)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(`${API}/incidents/:code/survey/`, ({ params }) => {
    if (!backend.sessionUser) return HttpResponse.json({ detail: 'Sin sesión.' }, { status: 401 })
    if (!ownIncident(String(params.code))) {
      return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    }
    return HttpResponse.json(stateOf(String(params.code)))
  }),

  http.post(`${API}/incidents/:code/survey/`, async ({ request, params }) => {
    if (!backend.sessionUser) return HttpResponse.json({ detail: 'Sin sesión.' }, { status: 401 })
    const code = String(params.code).toUpperCase()
    if (!ownIncident(code)) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    const body = (await request.json()) as { closure?: number; rating?: number; comment?: string }
    surveyBackend.requests.push({ body, csrfHeader: request.headers.get('X-CSRFToken') })
    if (request.headers.get('X-CSRFToken') !== backend.csrfToken) {
      return HttpResponse.json({ detail: 'CSRF Failed.' }, { status: 403 })
    }
    if (surveyBackend.nextError) {
      const { status, body: errorBody } = surveyBackend.nextError
      surveyBackend.nextError = null
      return HttpResponse.json(errorBody, { status })
    }
    const state = stateOf(code)
    if (!state.pending || state.pending.closure !== body.closure) {
      return HttpResponse.json({ detail: 'Este cierre técnico ya fue evaluado.' }, { status: 409 })
    }
    if (!Number.isInteger(body.rating) || body.rating! < 1 || body.rating! > 5) {
      return HttpResponse.json({ rating: ['Selecciona una calificación de 1 a 5 estrellas.'] }, { status: 400 })
    }
    surveyBackend.states[code] = {
      pending: null,
      history: [
        {
          closure: state.pending.closure,
          closed_at: state.pending.closed_at,
          rating: body.rating!,
          comment: (body.comment ?? '').trim(),
          created_at: '2026-11-09T09:30:00-05:00',
        },
        ...state.history,
      ],
    }
    return HttpResponse.json(stateOf(code), { status: 201 })
  }),
]
