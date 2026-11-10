/**
 * Backend simulado de atención, verificación y reapertura (ADR 0006). Datos ficticios.
 * Comparte las incidencias del backend simulado de planificación. La autoridad real
 * es el backend de Django: aquí solo se reproducen las respuestas que usa la interfaz.
 */
import { http, HttpResponse } from 'msw'

import type { IncidentDetail } from '../features/incidents/api'
import { backend } from './fakeBackend'
import { planningBackend } from './fakePlanning'

export interface AttentionRequest {
  path: string
  body: unknown
  csrfHeader: string | null
}

export const attentionBackend: { requests: AttentionRequest[]; conflictNext: boolean; reset: () => void } = {
  requests: [],
  conflictNext: false,
  reset() {
    attentionBackend.requests = []
    attentionBackend.conflictNext = false
  },
}

const API = '*/api/v1'

function roles() {
  return backend.sessionUser?.roles ?? []
}

function find(code: unknown): IncidentDetail | undefined {
  return planningBackend.incidents.find((item) => item.code === String(code).toUpperCase())
}

function guard(role: string): Response | null {
  if (backend.networkDown) return HttpResponse.error()
  if (!backend.sessionUser) {
    return HttpResponse.json({ detail: 'Sin sesión.', code: 'not_authenticated' }, { status: 401 })
  }
  if (!roles().includes(role)) return HttpResponse.json({ detail: 'No tiene permiso.' }, { status: 403 })
  return null
}

/** Verificar y reabrir: rol Planificador o función de verificar (ADR 0008). */
function verifierGuard(): Response | null {
  if (backend.sessionUser?.capabilities?.can_verify && !backend.networkDown) return null
  return guard('planificador')
}

function csrfFailed(request: Request) {
  return request.headers.get('X-CSRFToken') !== backend.csrfToken
}

export const attentionHandlers = [
  http.get(`${API}/incidents/attention/`, ({ request }) => {
    const blocked = guard('personal_atencion')
    if (blocked) return blocked
    const state = new URL(request.url).searchParams.get('status')
    const results = planningBackend.incidents
      .filter((item) => (state ? item.status === state : true))
      .map((item) => ({
        code: item.code,
        status: item.status,
        status_label: item.status_label,
        care_unit: item.care_unit,
        support_area: item.support_area,
        description_excerpt: item.description,
        created_by: item.created_by,
        created_at: item.created_at,
        priority: item.priority ?? null,
        assignment: item.assignment
          ? {
              id: item.assignment.id,
              technician: item.assignment.technician,
              scheduled_at: item.assignment.scheduled_at,
            }
          : null,
        has_attachments: false,
        last_result: null,
        pending_verification: false,
      }))
    attentionBackend.requests.push({ path: new URL(request.url).pathname + new URL(request.url).search, body: null, csrfHeader: null })
    return HttpResponse.json({ count: results.length, next: null, previous: null, results })
  }),

  // Solo se alcanza sin archivos (jsdom no puede enviarlos): reproduce la validación.
  http.post(`${API}/incidents/:code/interventions/`, async ({ request, params }) => {
    const blocked = guard('personal_atencion')
    if (blocked) return blocked
    if (csrfFailed(request)) return HttpResponse.json({ detail: 'CSRF Failed.' }, { status: 403 })
    if (!find(params.code)) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    if (attentionBackend.conflictNext) {
      attentionBackend.conflictNext = false
      return HttpResponse.json({ detail: 'La asignación cambió.' }, { status: 409 })
    }
    return HttpResponse.json(
      { photos: ['Adjunta al menos una fotografía de evidencia.'] },
      { status: 400 },
    )
  }),

  http.post(`${API}/incidents/:code/verification/`, async ({ request, params }) => {
    const blocked = verifierGuard()
    if (blocked) return blocked
    if (csrfFailed(request)) return HttpResponse.json({ detail: 'CSRF Failed.' }, { status: 403 })
    const incident = find(params.code)
    if (!incident?.closure) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    const body = (await request.json()) as { result: string; observations?: string }
    attentionBackend.requests.push({ path: new URL(request.url).pathname, body, csrfHeader: request.headers.get('X-CSRFToken') })
    if (incident.closure.verification) {
      return HttpResponse.json({ detail: 'Este cierre ya fue verificado.' }, { status: 409 })
    }
    if (body.result === 'not_conforming' && !body.observations) {
      return HttpResponse.json({ observations: ['Describe por qué la atención no es conforme.'] }, { status: 400 })
    }
    const verification = {
      id: 1,
      result: body.result as 'conforming' | 'not_conforming',
      result_label: body.result === 'conforming' ? 'Conforme' : 'No conforme',
      observations: body.observations ?? '',
      verified_by: { username: 'luis.prueba', full_name: 'Luis Prueba' },
      created_at: new Date().toISOString(),
    }
    incident.closure = { ...incident.closure, pending_verification: false, verification }
    incident.permissions = {
      ...incident.permissions!,
      can_verify: false,
      can_reopen: body.result === 'not_conforming',
    }
    return HttpResponse.json(incident)
  }),

  http.post(`${API}/incidents/:code/reopen/`, async ({ request, params }) => {
    const blocked = verifierGuard()
    if (blocked) return blocked
    if (csrfFailed(request)) return HttpResponse.json({ detail: 'CSRF Failed.' }, { status: 403 })
    const incident = find(params.code)
    if (!incident) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    const body = (await request.json()) as { reason: string }
    attentionBackend.requests.push({ path: new URL(request.url).pathname, body, csrfHeader: request.headers.get('X-CSRFToken') })
    if (!incident.permissions?.can_reopen) {
      return HttpResponse.json({ detail: 'Solo se puede reabrir tras No conforme.' }, { status: 409 })
    }
    incident.status = 'reabierta'
    incident.status_label = 'Reabierta'
    incident.closure = null
    incident.assignment = null
    incident.permissions = { can_plan: true, can_intervene: false, can_verify: false, can_reopen: false }
    return HttpResponse.json(incident)
  }),
]
