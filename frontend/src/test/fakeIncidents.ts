/**
 * Backend simulado de incidencias (contrato de backend/apps/incidents). Datos ficticios.
 * Usa la sesión del backend simulado de autenticación (fakeBackend.ts).
 */
import { http, HttpResponse } from 'msw'

import type { IncidentDetail } from '../features/incidents/api'
import { backend } from './fakeBackend'

const CARE_UNITS = [
  { code: 'demo-emergencia', name: '[DEMO] Emergencia', is_demo: true },
  { code: 'demo-laboratorio', name: '[DEMO] Laboratorio', is_demo: true },
]
const SUPPORT_AREAS = [
  { code: 'ingenieria_clinica', name: 'Ingeniería Clínica' },
  { code: 'mantenimiento', name: 'Mantenimiento' },
  { code: 'ti', name: 'TI' },
]

export interface RecordedSubmission {
  fields: Record<string, string>
  fileName: string | null
  csrfHeader: string | null
  passive: boolean
}

interface IncidentState {
  incidents: (IncidentDetail & { owner: string })[]
  submissions: RecordedSubmission[]
  nextId: number
  /** Errores de validación que devolverá el próximo POST (simula al servidor). */
  serverErrors: Record<string, string[]> | null
}

function initial(): IncidentState {
  return { incidents: [], submissions: [], nextId: 1, serverErrors: null }
}

export const incidentsBackend: IncidentState & {
  reset: () => void
  seed: (owner: string, overrides?: Partial<IncidentDetail>) => IncidentDetail
} = {
  ...initial(),
  reset() {
    Object.assign(incidentsBackend, initial())
  },
  seed(owner, overrides = {}) {
    const id = incidentsBackend.nextId++
    const incident = {
      code: `INC-2026-${String(id).padStart(6, '0')}`,
      status: 'registrada',
      status_label: 'Registrada',
      care_unit: CARE_UNITS[0],
      support_area: SUPPORT_AREAS[2],
      description: 'Descripción ficticia de una incidencia de prueba.',
      prior_actions: '',
      asset_reference: '',
      created_by: { username: owner, full_name: owner },
      created_at: new Date(Date.UTC(2026, 10, id, 15, 0)).toISOString(),
      attachments: [],
      events: [
        { event_type: 'created', label: 'Registrada', actor: owner, created_at: '2026-11-01T15:00:00Z' },
      ],
      ...overrides,
      owner,
    }
    incidentsBackend.incidents.unshift(incident)
    return incident
  },
}

function unauthenticated() {
  return HttpResponse.json(
    { detail: 'Las credenciales de autenticación no se proveyeron.', code: 'not_authenticated' },
    { status: 401 },
  )
}

function summary(incident: IncidentDetail) {
  return {
    code: incident.code,
    status: incident.status,
    status_label: incident.status_label,
    care_unit: incident.care_unit,
    support_area: incident.support_area,
    created_at: incident.created_at,
    has_attachments: incident.attachments.length > 0,
  }
}

const API = '*/api/v1'

export const incidentHandlers = [
  http.get(`${API}/incidents/options/`, () => {
    if (backend.networkDown) return HttpResponse.error()
    const user = backend.sessionUser
    if (!user) return unauthenticated()
    if (!user.roles.includes('solicitante')) {
      return HttpResponse.json({ detail: 'No tiene permiso.' }, { status: 403 })
    }
    return HttpResponse.json({ care_units: CARE_UNITS, support_areas: SUPPORT_AREAS })
  }),

  http.post(`${API}/incidents/`, async ({ request }) => {
    if (backend.networkDown) return HttpResponse.error()
    const user = backend.sessionUser
    if (!user) return unauthenticated()
    const form = await request.formData()
    const fields: Record<string, string> = {}
    let fileName: string | null = null
    form.forEach((value, key) => {
      if (typeof value === 'string') fields[key] = value
      else fileName = value.name
    })
    incidentsBackend.submissions.push({
      fields,
      fileName,
      csrfHeader: request.headers.get('X-CSRFToken'),
      passive: request.headers.get('X-SGIM-Passive') === '1',
    })
    if (request.headers.get('X-CSRFToken') !== backend.csrfToken) {
      return HttpResponse.json({ detail: 'CSRF Failed: CSRF token missing.' }, { status: 403 })
    }
    if (incidentsBackend.serverErrors) {
      return HttpResponse.json(incidentsBackend.serverErrors, { status: 400 })
    }
    const incident = incidentsBackend.seed(user.username, {
      care_unit: CARE_UNITS.find((unit) => unit.code === fields.care_unit) ?? CARE_UNITS[0],
      support_area: SUPPORT_AREAS.find((area) => area.code === fields.support_area) ?? SUPPORT_AREAS[0],
      description: fields.description,
      prior_actions: fields.prior_actions ?? '',
      asset_reference: fields.asset_reference ?? '',
      created_by: { username: user.username, full_name: user.full_name },
    })
    return HttpResponse.json(incident, { status: 201 })
  }),

  http.get(`${API}/incidents/`, ({ request }) => {
    if (backend.networkDown) return HttpResponse.error()
    const user = backend.sessionUser
    if (!user) return unauthenticated()
    const page = Number(new URL(request.url).searchParams.get('page') ?? '1')
    const own = incidentsBackend.incidents.filter((incident) => incident.owner === user.username)
    const results = own.slice((page - 1) * 20, page * 20).map(summary)
    return HttpResponse.json({
      count: own.length,
      next: page * 20 < own.length ? `?page=${page + 1}` : null,
      previous: page > 1 ? `?page=${page - 1}` : null,
      results,
    })
  }),

  http.get(`${API}/incidents/:code/`, ({ params }) => {
    if (backend.networkDown) return HttpResponse.error()
    const user = backend.sessionUser
    if (!user) return unauthenticated()
    const code = String(params.code).toUpperCase()
    const incident = incidentsBackend.incidents.find(
      (item) => item.code === code && item.owner === user.username,
    )
    if (!incident) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { owner, ...publicData } = incident
    return HttpResponse.json(publicData)
  }),
]
