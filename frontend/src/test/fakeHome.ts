/**
 * Resumen del Inicio simulado (ADR 0010). Por defecto se arma con las capacidades de la
 * sesión, como el backend: las secciones sin capacidad llegan como ``null``. Datos
 * ficticios.
 */
import { http, HttpResponse } from 'msw'

import type { HomeSummary } from '../features/workspace/homeApi'
import { backend } from './fakeBackend'

const OWN = {
  total: 3,
  by_status: [
    { key: 'registrada', label: 'Registrada', total: 1 },
    { key: 'asignada', label: 'Asignada', total: 1 },
    { key: 'cerrada', label: 'Cerrada', total: 1 },
    { key: 'reabierta', label: 'Reabierta', total: 0 },
  ],
}

function item(code: string, action: HomeSummary['todo']['items'][number]['action']) {
  const status = { attend: 'asignada', verify: 'cerrada', plan: 'registrada', follow_up: 'asignada' }[action]
  return {
    code,
    status,
    status_label: status.charAt(0).toUpperCase() + status.slice(1),
    area: 'ti',
    area_name: 'TI',
    care_unit: '[DEMO] Emergencia',
    action,
    date_label: { attend: 'Programada', verify: 'Cerrada', plan: 'Registrada', follow_up: 'Registrada' }[action],
    date: '2026-11-08T15:00:00-05:00',
  }
}

/** Resumen por defecto según las capacidades de quien inició sesión. */
export function defaultSummary(): HomeSummary {
  const user = backend.sessionUser
  const caps = user?.capabilities
  const operational = Boolean(user?.roles.some((role) => role !== 'administrador'))
  const items = [
    ...(caps?.can_attend ? [item('INC-2026-0201', 'attend')] : []),
    ...(caps?.can_verify ? [item('INC-2026-0202', 'verify')] : []),
    ...(caps?.can_plan ? [item('INC-2026-0203', 'plan'), item('INC-2026-0204', 'follow_up')] : []),
  ]
  return {
    own: operational ? OWN : null,
    attention: caps?.can_attend ? { assigned: 1 } : null,
    planning: caps?.can_plan ? { to_schedule: 1, follow_up: 1 } : null,
    verification: caps?.can_verify ? { pending: 1 } : null,
    surveys: null,
    todo: { total: items.length, items },
  }
}

export const homeBackend: { override: HomeSummary | null; calls: number; reset: () => void } = {
  override: null,
  calls: 0,
  reset() {
    homeBackend.override = null
    homeBackend.calls = 0
  },
}

export const homeHandlers = [
  http.get('*/api/v1/incidents/summary/', () => {
    if (!backend.sessionUser) {
      return HttpResponse.json({ detail: 'Sin sesión.', code: 'not_authenticated' }, { status: 401 })
    }
    homeBackend.calls += 1
    return HttpResponse.json(homeBackend.override ?? defaultSummary())
  }),
]
