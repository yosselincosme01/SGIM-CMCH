/**
 * Backend simulado de administración, indicadores y reportes (ADR 0007). Datos
 * ficticios. Reproduce las respuestas y reglas que usa la interfaz; la autoridad real
 * es el backend de Django (que vuelve a validar todo).
 */
import { http, HttpResponse } from 'msw'

import type { AdminUser } from '../features/admin/api'
import { backend } from './fakeBackend'

const API = '*/api/v1'

function makeAccount(id: number, username: string, roles: string[], extra: Partial<AdminUser> = {}): AdminUser {
  const [first] = username.split('.')
  return {
    id,
    username,
    first_name: first.charAt(0).toUpperCase() + first.slice(1),
    last_name: 'Prueba',
    full_name: `${first.charAt(0).toUpperCase() + first.slice(1)} Prueba`,
    email: '',
    is_active: true,
    last_login: null,
    date_joined: '2026-11-01T15:00:00Z',
    roles,
    memberships: [],
    is_protected: roles.includes('administrador'),
    open_assignment_areas: [],
    ...extra,
  }
}

export interface AdminRequest {
  method: string
  path: string
  body: unknown
  csrfHeader: string | null
}

interface AdminState {
  users: AdminUser[]
  nextId: number
  requests: AdminRequest[]
  /** Respuesta forzada para el próximo POST/PATCH (simula errores del servidor). */
  nextError: { status: number; body: Record<string, unknown> } | null
}

function initial(): AdminState {
  return {
    users: [
      makeAccount(3, 'admin.prueba', ['administrador']),
      makeAccount(10, 'tec.uno', ['personal_atencion'], {
        memberships: [
          { area: 'ti', area_name: 'TI', can_plan: false, can_be_assigned: true, can_verify: false },
        ],
        open_assignment_areas: ['ti'],
      }),
      makeAccount(11, 'sol.dos', ['solicitante']),
    ],
    nextId: 20,
    requests: [],
    nextError: null,
  }
}

export const adminBackend: AdminState & { reset: () => void } = {
  ...initial(),
  reset() {
    Object.assign(adminBackend, initial())
  },
}

export const DASHBOARD = {
  scope: 'global',
  filters: { date_from: '2026-10-09', date_to: '2026-11-07', area: '', status: '' },
  tickets: {
    total: 4,
    open: 3,
    pending_management: 2,
    in_progress: 1,
    closed: 1,
    pending_verification: 0,
    reopened: 1,
  },
  cycles: { conforming: 1, not_conforming: 1, reopenings: 1 },
  interventions: {
    total: 4,
    by_result: [
      { key: 'solved', label: 'Solucionado', total: 2 },
      { key: 'in_progress', label: 'En proceso', total: 1 },
    ],
  },
  times: {
    avg_hours_to_first_intervention: 5.5,
    tickets_with_intervention: 3,
    avg_hours_to_closure: null,
    closed_tickets_measured: 0,
  },
  by_status: [{ key: 'asignada', label: 'Asignada', total: 1 }],
  by_area: [{ key: 'ti', label: 'TI', total: 3 }],
  by_care_unit: [{ key: 'demo-emergencia', label: '[DEMO] Emergencia', total: 4 }],
  by_priority: [{ key: '', label: 'Sin prioridad', total: 1 }],
}

const AREA_TI = { code: 'ti', name: 'TI' }
const UNIT = { code: 'demo-emergencia', name: '[DEMO] Emergencia', is_demo: true }

export const GLOBAL_INCIDENTS = [
  {
    code: 'INC-2026-0101',
    status: 'cerrada',
    status_label: 'Cerrada',
    care_unit: UNIT,
    support_area: AREA_TI,
    description_excerpt: 'Impresora de admisión sin conexión (ficticio).',
    created_by: { username: 'ana.prueba', full_name: 'Ana Prueba' },
    created_at: '2026-11-05T14:00:00Z',
    priority: null,
    assignment: null,
    has_attachments: true,
    last_result: null,
    pending_verification: true,
  },
  {
    code: 'INC-2026-0102',
    status: 'registrada',
    status_label: 'Registrada',
    care_unit: UNIT,
    support_area: { code: 'mantenimiento', name: 'Mantenimiento' },
    description_excerpt: 'Puerta de emergencia atascada (ficticio).',
    created_by: { username: 'ana.prueba', full_name: 'Ana Prueba' },
    created_at: '2026-11-06T14:00:00Z',
    priority: null,
    assignment: null,
    has_attachments: false,
    last_result: null,
    pending_verification: false,
  },
]

/** Detalle de solo lectura: sin ``attachments``, sin fotos y sin ``permissions``. */
export const GLOBAL_DETAIL = {
  ...GLOBAL_INCIDENTS[0],
  description: 'Impresora de admisión sin conexión (ficticio).',
  prior_actions: '',
  equipment_qr_status: 'qr_readable',
  equipment_qr_status_label: 'QR legible',
  qr_code: 'QR-FICTICIO-01',
  attachment_count: 1,
  events: [
    {
      event_type: 'created',
      label: 'Incidencia registrada',
      actor: 'Ana Prueba',
      from_status: null,
      to_status: 'registrada',
      details: {},
      created_at: '2026-11-05T14:00:00Z',
    },
  ],
  interventions: [
    {
      id: 1,
      assignment: 1,
      technician: { username: 'tec.uno', full_name: 'Tomás Prueba' },
      result: 'solved',
      result_label: 'Solucionado',
      diagnosis: 'Cable de red dañado (ficticio).',
      actions_taken: 'Se reemplazó el cable.',
      used_parts: false,
      used_parts_detail: '',
      parts_required: false,
      parts_required_detail: '',
      unresolved_reason: '',
      observations: '',
      photo_count: 2,
      is_closure: true,
      verification: null,
      created_at: '2026-11-05T18:00:00Z',
    },
  ],
  closure: null,
}

export const AUDIT = [
  {
    id: 2,
    action: 'report_exported',
    action_label: 'Reporte exportado',
    actor: 'admin.prueba',
    target_user: null,
    details: { report: 'incidents', rows: 4 },
    created_at: '2026-11-07T15:00:00Z',
  },
  {
    id: 1,
    action: 'user_created',
    action_label: 'Cuenta creada',
    actor: 'admin.prueba',
    target_user: 'tec.uno',
    details: { username: 'tec.uno' },
    created_at: '2026-11-06T15:00:00Z',
  },
]

function roles() {
  return backend.sessionUser?.roles ?? []
}

function forbidden() {
  return HttpResponse.json({ detail: 'No tiene permiso.' }, { status: 403 })
}

function unauthenticated() {
  return HttpResponse.json({ detail: 'Sin sesión.', code: 'not_authenticated' }, { status: 401 })
}

async function record(request: Request) {
  let body: unknown = null
  if (request.method !== 'GET') body = await request.clone().json().catch(() => null)
  const url = new URL(request.url)
  adminBackend.requests.push({
    method: request.method,
    path: url.pathname + url.search,
    body,
    csrfHeader: request.headers.get('X-CSRFToken'),
  })
  return body as Record<string, unknown> | null
}

function adminGuard() {
  if (!backend.sessionUser) return unauthenticated()
  if (!roles().includes('administrador')) return forbidden()
  return null
}

function scopeGuard() {
  if (!backend.sessionUser) return unauthenticated()
  if (!roles().includes('administrador') && !roles().includes('planificador')) return forbidden()
  return null
}

export const adminHandlers = [
  http.get(`${API}/reports/options/`, async ({ request }) => {
    const blocked = scopeGuard()
    if (blocked) return blocked
    await record(request)
    const global = roles().includes('administrador')
    return HttpResponse.json({
      scope: global ? 'global' : 'planner',
      areas: global
        ? [
            { code: 'ingenieria_clinica', name: 'Ingeniería Clínica' },
            { code: 'mantenimiento', name: 'Mantenimiento' },
            { code: 'ti', name: 'TI' },
          ]
        : [{ code: 'ti', name: 'TI' }],
      reports: [
        { code: 'incidents', label: 'Incidencias generales' },
        { code: 'pending', label: 'Pendientes' },
      ],
      max_rows: 5000,
      max_range_days: 366,
    })
  }),

  http.get(`${API}/reports/dashboard/`, async ({ request }) => {
    const blocked = scopeGuard()
    if (blocked) return blocked
    await record(request)
    return HttpResponse.json({
      ...DASHBOARD,
      scope: roles().includes('administrador') ? 'global' : 'planner',
    })
  }),

  http.get(`${API}/admin/options/`, async ({ request }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    await record(request)
    return HttpResponse.json({
      roles: [
        { code: 'solicitante', label: 'Solicitante' },
        { code: 'planificador', label: 'Responsable de Área' },
        { code: 'personal_atencion', label: 'Personal de Atención' },
      ],
      areas: [
        { code: 'ingenieria_clinica', name: 'Ingeniería Clínica' },
        { code: 'mantenimiento', name: 'Mantenimiento' },
        { code: 'ti', name: 'TI' },
      ],
      audit_actions: [
        { code: 'user_created', label: 'Cuenta creada' },
        { code: 'report_exported', label: 'Reporte exportado' },
      ],
    })
  }),

  http.get(`${API}/admin/incidents/`, async ({ request }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    await record(request)
    const params = new URL(request.url).searchParams
    const results = GLOBAL_INCIDENTS.filter(
      (item) =>
        (!params.get('area') || item.support_area.code === params.get('area')) &&
        (!params.get('status') || item.status === params.get('status')),
    )
    return HttpResponse.json({ count: results.length, next: null, previous: null, results })
  }),

  http.get(`${API}/admin/incidents/:code/`, async ({ request, params }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    await record(request)
    if (params.code !== GLOBAL_DETAIL.code) {
      return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    }
    return HttpResponse.json(GLOBAL_DETAIL)
  }),

  http.get(`${API}/admin/audit/`, async ({ request }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    await record(request)
    const action = new URL(request.url).searchParams.get('action')
    const results = AUDIT.filter((item) => !action || item.action === action)
    return HttpResponse.json({ count: results.length, next: null, previous: null, results })
  }),

  http.get(`${API}/admin/users/`, async ({ request }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    await record(request)
    const params = new URL(request.url).searchParams
    const q = (params.get('q') ?? '').toLowerCase()
    const results = adminBackend.users.filter(
      (user) =>
        (!q || user.username.includes(q) || user.full_name.toLowerCase().includes(q)) &&
        (!params.get('role') || user.roles.includes(params.get('role')!)) &&
        (!params.get('active') || String(user.is_active) === params.get('active')),
    )
    return HttpResponse.json({ count: results.length, next: null, previous: null, results })
  }),

  http.post(`${API}/admin/users/`, async ({ request }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    const body = (await record(request)) ?? {}
    if (request.headers.get('X-CSRFToken') !== backend.csrfToken) return forbidden()
    if (adminBackend.nextError) {
      const { status, body: errorBody } = adminBackend.nextError
      adminBackend.nextError = null
      return HttpResponse.json(errorBody, { status })
    }
    const user = makeAccount(adminBackend.nextId++, String(body.username), body.roles as string[], {
      first_name: String(body.first_name),
      last_name: String(body.last_name),
      full_name: `${body.first_name} ${body.last_name}`,
      memberships: body.memberships as AdminUser['memberships'],
    })
    adminBackend.users.push(user)
    return HttpResponse.json(user, { status: 201 })
  }),

  http.get(`${API}/admin/users/:id/`, async ({ request, params }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    await record(request)
    const user = adminBackend.users.find((item) => item.id === Number(params.id))
    return user ? HttpResponse.json(user) : HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
  }),

  http.patch(`${API}/admin/users/:id/`, async ({ request, params }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    const body = (await record(request)) ?? {}
    const user = adminBackend.users.find((item) => item.id === Number(params.id))
    if (!user) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    if (user.is_protected) return HttpResponse.json({ detail: 'Cuenta protegida.' }, { status: 403 })
    if (adminBackend.nextError) {
      const { status, body: errorBody } = adminBackend.nextError
      adminBackend.nextError = null
      return HttpResponse.json(errorBody, { status })
    }
    Object.assign(user, body)
    return HttpResponse.json(user)
  }),

  http.post(`${API}/admin/users/:id/activation/`, async ({ request, params }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    const body = ((await record(request)) ?? {}) as { active?: boolean }
    const user = adminBackend.users.find((item) => item.id === Number(params.id))
    if (!user) return HttpResponse.json({ detail: 'No encontrado.' }, { status: 404 })
    if (user.open_assignment_areas.length && body.active === false) {
      return HttpResponse.json(
        { detail: 'La persona tiene asignaciones vigentes. Pide al Responsable de Área que las reasigne.' },
        { status: 409 },
      )
    }
    user.is_active = Boolean(body.active)
    return HttpResponse.json(user)
  }),

  http.post(`${API}/admin/users/:id/password/`, async ({ request }) => {
    const blocked = adminGuard()
    if (blocked) return blocked
    await record(request)
    return new HttpResponse(null, { status: 204 })
  }),
]
