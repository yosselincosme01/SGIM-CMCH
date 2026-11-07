/**
 * Backend simulado de planificación (contrato de backend/apps/incidents, ADR 0004).
 * Datos ficticios. Usa la sesión del backend simulado de autenticación.
 *
 * Reproduce las reglas del servidor que importan a la interfaz: solo el rol
 * planificador accede; CSRF en escrituras; 409 si la asignación cambió; motivo
 * obligatorio al reprogramar. La autoridad real es el backend de Django.
 */
import { http, HttpResponse } from 'msw'

import type { IncidentDetail, IncidentEvent, PriorityLevel } from '../features/incidents/api'
import type { PlanningItem, Technician } from '../features/planning/api'
import { backend } from './fakeBackend'

export const PRIORITIES: PriorityLevel[] = [
  { code: 'critica', name: 'Crítica', order: 1, description: '', is_provisional: true },
  { code: 'alta', name: 'Alta', order: 2, description: '', is_provisional: true },
  { code: 'media', name: 'Media', order: 3, description: '', is_provisional: true },
  { code: 'baja', name: 'Baja', order: 4, description: '', is_provisional: true },
]

export const TECHNICIANS: Technician[] = [
  { username: 'tec.uno', full_name: 'Tomás Prueba', active_assignments: 2, next_scheduled_at: null },
  { username: 'tec.dos', full_name: 'Rosa Prueba', active_assignments: 0, next_scheduled_at: null },
]

const AREA = { code: 'ti', name: 'TI' }
const UNIT = { code: 'demo-emergencia', name: '[DEMO] Emergencia', is_demo: true }

export interface PlanningRequest {
  method: string
  path: string
  body: Record<string, unknown> | null
  csrfHeader: string | null
  passive: boolean
}

interface PlanningState {
  incidents: IncidentDetail[]
  technicians: Technician[]
  requests: PlanningRequest[]
  nextAssignmentId: number
  /** El próximo POST de programación responde 409 (otro Planificador lo cambió). */
  conflictNext: boolean
  serverErrors: Record<string, string[]> | null
}

function initial(): PlanningState {
  return {
    incidents: [],
    technicians: TECHNICIANS.map((person) => ({ ...person })),
    requests: [],
    nextAssignmentId: 1,
    conflictNext: false,
    serverErrors: null,
  }
}

function event(type: string, label: string, details?: Record<string, unknown>): IncidentEvent {
  return {
    event_type: type,
    label,
    actor: 'Luis Prueba',
    created_at: new Date().toISOString(),
    from_status: '',
    to_status: '',
    details: details ?? {},
  }
}

export const planningBackend: PlanningState & {
  reset: () => void
  seed: (overrides?: Partial<IncidentDetail>) => IncidentDetail
} = {
  ...initial(),
  reset() {
    Object.assign(planningBackend, initial())
  },
  seed(overrides = {}) {
    const number = planningBackend.incidents.length + 1
    const incident: IncidentDetail = {
      code: `INC-2026-${String(100 + number).padStart(6, '0')}`,
      status: 'registrada',
      status_label: 'Registrada',
      care_unit: UNIT,
      support_area: AREA,
      description: `Descripción ficticia de la incidencia ${number} para planificar.`,
      prior_actions: '',
      asset_reference: '',
      created_by: { username: 'ana.prueba', full_name: 'Ana Prueba' },
      created_at: '2026-11-02T14:00:00Z',
      attachments: [],
      events: [{ ...event('created', 'Registrada'), actor: 'Ana Prueba' }],
      priority: null,
      assignment: null,
      permissions: { can_plan: true },
      ...overrides,
    }
    planningBackend.incidents.push(incident)
    return incident
  },
}

function isPlanner() {
  return backend.sessionUser?.roles.includes('planificador') ?? false
}

function guard(): Response | null {
  if (backend.networkDown) return HttpResponse.error()
  if (!backend.sessionUser) {
    return HttpResponse.json(
      { detail: 'Las credenciales de autenticación no se proveyeron.', code: 'not_authenticated' },
      { status: 401 },
    )
  }
  if (!isPlanner()) return HttpResponse.json({ detail: 'No tiene permiso.' }, { status: 403 })
  return null
}

function find(code: unknown) {
  return planningBackend.incidents.find((item) => item.code === String(code).toUpperCase())
}

function summary(incident: IncidentDetail): PlanningItem {
  return {
    code: incident.code,
    status: incident.status,
    status_label: incident.status_label,
    care_unit: incident.care_unit,
    support_area: incident.support_area,
    description_excerpt: incident.description,
    created_by: incident.created_by,
    created_at: incident.created_at,
    priority: incident.priority ?? null,
    assignment: incident.assignment
      ? {
          id: incident.assignment.id,
          technician: incident.assignment.technician,
          scheduled_at: incident.assignment.scheduled_at,
        }
      : null,
    has_attachments: false,
  }
}

async function record(request: Request) {
  let body: Record<string, unknown> | null = null
  if (request.method !== 'GET') body = (await request.clone().json()) as Record<string, unknown>
  planningBackend.requests.push({
    method: request.method,
    path: new URL(request.url).pathname,
    body,
    csrfHeader: request.headers.get('X-CSRFToken'),
    passive: request.headers.get('X-SGIM-Passive') === '1',
  })
  return body
}

function csrfFailed(request: Request) {
  return request.headers.get('X-CSRFToken') !== backend.csrfToken
}

/** "AAAA-MM-DDTHH:mm" en hora de Lima → ISO con desfase de Lima (UTC-5, sin horario de verano). */
function limaIso(value: string) {
  return `${value}:00-05:00`
}

const API = '*/api/v1'

export const planningHandlers = [
  http.get(`${API}/incidents/planning/options/`, async ({ request }) => {
    const blocked = guard()
    if (blocked) return blocked
    await record(request)
    const open = planningBackend.incidents
    return HttpResponse.json({
      areas: [AREA],
      priorities: PRIORITIES,
      counts: {
        unprioritized: open.filter((item) => !item.priority).length,
        unassigned: open.filter((item) => item.status === 'registrada').length,
        scheduled_today: 0,
      },
    })
  }),

  http.get(`${API}/incidents/planning/`, async ({ request }) => {
    const blocked = guard()
    if (blocked) return blocked
    await record(request)
    const params = new URL(request.url).searchParams
    let results = [...planningBackend.incidents]
    const priority = params.get('priority')
    if (priority === 'none') results = results.filter((item) => !item.priority)
    else if (priority) results = results.filter((item) => item.priority?.code === priority)
    const state = params.get('status')
    if (state) results = results.filter((item) => item.status === state)
    const q = params.get('q')?.toLowerCase()
    if (q) {
      results = results.filter(
        (item) => item.code.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
      )
    }
    return HttpResponse.json({
      count: results.length,
      next: null,
      previous: null,
      results: results.map(summary),
    })
  }),

  // Detalle del personal del área. Si la incidencia no está aquí, sigue al siguiente handler.
  http.get(`${API}/incidents/:code/`, ({ params }) => {
    if (!isPlanner()) return undefined
    const incident = find(params.code)
    if (!incident) return undefined
    return HttpResponse.json(incident)
  }),

  http.get(`${API}/incidents/:code/technicians/`, async ({ request, params }) => {
    const blocked = guard()
    if (blocked) return blocked
    await record(request)
    if (!find(params.code)) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    return HttpResponse.json({ results: planningBackend.technicians })
  }),

  http.put(`${API}/incidents/:code/priority/`, async ({ request, params }) => {
    const blocked = guard()
    if (blocked) return blocked
    const body = (await record(request)) ?? {}
    if (csrfFailed(request)) {
      return HttpResponse.json({ detail: 'CSRF Failed: CSRF token missing.' }, { status: 403 })
    }
    const incident = find(params.code)
    if (!incident) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    const level = PRIORITIES.find((item) => item.code === body.priority)
    if (!level) {
      return HttpResponse.json({ priority: ['Selecciona una prioridad válida.'] }, { status: 400 })
    }
    incident.events.push(
      event('priority_changed', 'Prioridad actualizada', {
        from: incident.priority ? { code: incident.priority.code, name: incident.priority.name } : null,
        to: { code: level.code, name: level.name },
        ...(body.reason ? { reason: body.reason } : {}),
      }),
    )
    incident.priority = level
    return HttpResponse.json(incident)
  }),

  http.post(`${API}/incidents/:code/planning/`, async ({ request, params }) => {
    const blocked = guard()
    if (blocked) return blocked
    const body = (await record(request)) ?? {}
    if (csrfFailed(request)) {
      return HttpResponse.json({ detail: 'CSRF Failed: CSRF token missing.' }, { status: 403 })
    }
    const incident = find(params.code)
    if (!incident) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    if (planningBackend.serverErrors) {
      return HttpResponse.json(planningBackend.serverErrors, { status: 400 })
    }
    const current = incident.assignment ?? null
    if (planningBackend.conflictNext || (current?.id ?? null) !== body.expected_assignment) {
      planningBackend.conflictNext = false
      return HttpResponse.json(
        { detail: 'Otro Planificador actualizó esta incidencia.' },
        { status: 409 },
      )
    }
    if (current && String(body.reason ?? '').length < 10) {
      return HttpResponse.json(
        { reason: ['Indica el motivo del cambio (al menos 10 caracteres).'] },
        { status: 400 },
      )
    }
    const technician = planningBackend.technicians.find((p) => p.username === body.technician)
    if (!technician) {
      return HttpResponse.json(
        { technician: ['La persona seleccionada no es técnico autorizado de esta área.'] },
        { status: 400 },
      )
    }
    const level = PRIORITIES.find((item) => item.code === body.priority) ?? null
    incident.priority = level
    const scheduledAt = limaIso(String(body.scheduled_at))
    incident.assignment = {
      id: planningBackend.nextAssignmentId++,
      technician: { username: technician.username, full_name: technician.full_name },
      assigned_by: { username: 'luis.prueba', full_name: 'Luis Prueba' },
      scheduled_at: scheduledAt,
      notes: String(body.notes ?? ''),
      created_at: new Date().toISOString(),
    }
    if (current) {
      if (current.technician.username !== technician.username) {
        incident.events.push(
          event('technician_changed', 'Técnico responsable reasignado', {
            from: current.technician,
            to: incident.assignment.technician,
            reason: body.reason,
          }),
        )
      }
      if (current.scheduled_at !== scheduledAt) {
        incident.events.push(
          event('schedule_changed', 'Atención reprogramada', {
            from: current.scheduled_at,
            to: scheduledAt,
            reason: body.reason,
          }),
        )
      }
    } else {
      incident.status = 'asignada'
      incident.status_label = 'Asignada'
      incident.events.push(
        event('assigned', 'Atención programada', {
          technician: incident.assignment.technician,
          scheduled_at: scheduledAt,
          priority: level,
        }),
      )
    }
    return HttpResponse.json(incident)
  }),
]
