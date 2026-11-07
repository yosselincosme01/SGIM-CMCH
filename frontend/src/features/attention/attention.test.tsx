import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { attentionBackend } from '../../test/fakeAttention'
import { backend, USERS } from '../../test/fakeBackend'
import { incidentsBackend } from '../../test/fakeIncidents'
import { planningBackend } from '../../test/fakePlanning'
import { renderApp } from '../../test/renderApp'
import type { IncidentDetail, Intervention } from '../incidents/api'

const ASSIGNMENT = {
  id: 7,
  technician: { username: 'tec.uno', full_name: 'Tomás Prueba' },
  assigned_by: { username: 'luis.prueba', full_name: 'Luis Prueba' },
  scheduled_at: '2030-01-10T09:00:00-05:00',
  notes: 'Llevar multímetro (indicación ficticia).',
  created_at: '2026-11-03T15:00:00Z',
}

const PERMS = { can_plan: false, can_intervene: false, can_verify: false, can_reopen: false }

function signIn(user: (typeof USERS)[keyof typeof USERS]) {
  backend.signIn(user)
  document.cookie = `csrftoken=${backend.csrfToken}; path=/`
}

function seedAssigned(overrides: Partial<IncidentDetail> = {}) {
  return planningBackend.seed({
    status: 'asignada',
    status_label: 'Asignada',
    assignment: ASSIGNMENT,
    permissions: { ...PERMS, can_intervene: true },
    ...overrides,
  })
}

function intervention(overrides: Partial<Intervention> = {}): Intervention {
  return {
    id: 1,
    assignment: 7,
    technician: { username: 'tec.uno', full_name: 'Tomás Prueba' },
    result: 'not_solved',
    result_label: 'No solucionado',
    diagnosis: 'Fuente dañada (ficticio).',
    actions_taken: 'Se revisó la alimentación.',
    used_parts: false,
    used_parts_detail: '',
    parts_required: true,
    parts_required_detail: 'Fuente de 500 W (ficticio).',
    unresolved_reason: 'Falta el repuesto.',
    observations: '',
    photos: [],
    is_closure: false,
    verification: null,
    created_at: '2026-11-04T15:00:00Z',
    ...overrides,
  }
}

function seedClosed(permissions: Partial<IncidentDetail['permissions']> = {}) {
  const closing = intervention({
    id: 2,
    result: 'solved',
    result_label: 'Solucionado',
    unresolved_reason: '',
    is_closure: true,
  })
  return planningBackend.seed({
    status: 'cerrada',
    status_label: 'Cerrada',
    assignment: null,
    interventions: [closing],
    closure: {
      intervention: 2,
      closed_by: { username: 'tec.uno', full_name: 'Tomás Prueba' },
      closed_at: '2026-11-05T15:00:00-05:00',
      pending_verification: true,
      verification: null,
    },
    permissions: { ...PERMS, can_verify: true, ...permissions },
  })
}

async function openAttention(code: string) {
  signIn(USERS.tecnico)
  const utils = renderApp(`/personal-atencion/incidencias/${code}`)
  await screen.findByRole('heading', { name: code, level: 1 })
  return utils
}

/** Intercepta el POST con archivos (jsdom no puede enviarlos) y devuelve el FormData. */
function captureIntervention(response: unknown, status = 201) {
  const realFetch = globalThis.fetch
  let body: FormData | null = null
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.method === 'POST' && url.includes('/interventions/')) {
      body = init.body as FormData
      return new Response(JSON.stringify(response), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return realFetch(input, init)
  })
  return () => {
    if (!body) throw new Error('No se envió la intervención.')
    return body
  }
}

const photo = () => new File([new Uint8Array(1024)], 'evidencia.jpg', { type: 'image/jpeg' })

// --- Bandeja ---------------------------------------------------------------------

describe('bandeja del Personal de Atención', () => {
  it('se accede desde el inicio y lista las incidencias asignadas', async () => {
    seedAssigned()
    signIn(USERS.tecnico)
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('link', { name: /Personal de Atención/ }))

    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: /Atender INC-/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/personal-atencion\/incidencias\/INC-/),
    )
    expect(attentionBackend.requests.at(-1)?.path).toContain('status=asignada')
  })

  it('filtra por estado', async () => {
    seedAssigned()
    signIn(USERS.tecnico)
    const { user } = renderApp('/personal-atencion')
    await screen.findByRole('table')

    await user.selectOptions(screen.getByLabelText('Estado'), 'cerrada')

    expect(await screen.findByText('No hay incidencias en esta vista')).toBeInTheDocument()
    expect(attentionBackend.requests.at(-1)?.path).toContain('status=cerrada')
  })

  it('sin el rol no se muestra la vista', async () => {
    signIn(USERS.solicitante)
    renderApp('/personal-atencion')

    expect(await screen.findByRole('heading', { name: 'No tienes acceso a esta vista' })).toBeInTheDocument()
  })
})

// --- Intervención ----------------------------------------------------------------

describe('registro de intervención', () => {
  it('muestra la asignación y valida los datos obligatorios sin enviar nada', async () => {
    const incident = seedAssigned()
    const { user } = await openAttention(incident.code)
    expect(screen.getByText('Llevar multímetro (indicación ficticia).')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Registrar intervención' }))

    expect(screen.getByText('El diagnóstico técnico es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('Las acciones realizadas es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('Selecciona el resultado de la intervención.')).toBeInTheDocument()
    expect(screen.getByText('Indica si se utilizaron repuestos.')).toBeInTheDocument()
    expect(screen.getByText('Indica si se requieren repuestos.')).toBeInTheDocument()
    expect(screen.getByText('Adjunta al menos una fotografía de evidencia.')).toBeInTheDocument()
    expect(screen.getByLabelText(/Diagnóstico técnico/)).toHaveFocus()
  })

  it('pide motivo si no quedó solucionado y detalle de repuestos si se indica Sí', async () => {
    const incident = seedAssigned()
    const { user } = await openAttention(incident.code)
    await user.click(screen.getByRole('radio', { name: /No solucionado/ }))
    const [usedYes] = within(screen.getByRole('group', { name: /utilizaron repuestos/ })).getAllByRole('radio')
    await user.click(usedYes)

    await user.click(screen.getByRole('button', { name: 'Registrar intervención' }))

    expect(screen.getByText(/Indica el motivo \(al menos 10 caracteres\)/)).toBeInTheDocument()
    expect(screen.getByText('Describe los repuestos utilizados.')).toBeInTheDocument()
  })

  it('envía la intervención con fotos y CSRF; "Solucionado" informa el cierre', async () => {
    const incident = seedAssigned()
    const closedResponse = seedClosed()
    const sent = captureIntervention(closedResponse)
    const { user } = await openAttention(incident.code)

    await user.type(screen.getByLabelText(/Diagnóstico técnico/), 'Fuente dañada.')
    await user.type(screen.getByLabelText(/Acciones realizadas/), 'Se reemplazó la fuente.')
    await user.click(screen.getByRole('radio', { name: /^Solucionado/ }))
    const usedNo = within(screen.getByRole('group', { name: /utilizaron repuestos/ })).getAllByRole('radio')[1]
    const requiredNo = within(screen.getByRole('group', { name: /requieren repuestos/ })).getAllByRole('radio')[1]
    await user.click(usedNo)
    await user.click(requiredNo)
    await user.upload(screen.getByLabelText('Agregar fotografías'), photo())
    await user.click(screen.getByRole('button', { name: 'Registrar intervención' }))

    expect(await screen.findByText(/quedó cerrada y pendiente de verificación/)).toBeInTheDocument()
    const body = sent()
    expect(body.get('assignment')).toBe('7')
    expect(body.get('result')).toBe('solved')
    expect(body.get('used_parts')).toBe('false')
    expect(body.get('parts_required')).toBe('false')
    expect(body.has('unresolved_reason')).toBe(false)
    expect(body.getAll('photos')).toHaveLength(1)
    expect(body.has('status')).toBe(false)
    expect(body.has('technician')).toBe(false)
  })

  it('si la asignación cambió (409) lo informa y recarga', async () => {
    const incident = seedAssigned()
    const sent = captureIntervention({ detail: 'La asignación cambió.' }, 409)
    const { user } = await openAttention(incident.code)
    await user.type(screen.getByLabelText(/Diagnóstico técnico/), 'Diagnóstico.')
    await user.type(screen.getByLabelText(/Acciones realizadas/), 'Acciones.')
    await user.click(screen.getByRole('radio', { name: /^Solucionado/ }))
    for (const name of [/utilizaron repuestos/, /requieren repuestos/]) {
      await user.click(within(screen.getByRole('group', { name })).getAllByRole('radio')[1])
    }
    await user.upload(screen.getByLabelText('Agregar fotografías'), photo())

    await user.click(screen.getByRole('button', { name: 'Registrar intervención' }))

    expect(await screen.findByText(/La incidencia cambió/)).toBeInTheDocument()
    expect(sent().get('assignment')).toBe('7')
  })

  it('una incidencia cerrada no muestra el formulario', async () => {
    const incident = seedClosed({ can_verify: false })
    await openAttention(incident.code)

    expect(screen.queryByRole('button', { name: 'Registrar intervención' })).not.toBeInTheDocument()
    expect(screen.getByText(/No admite nuevas intervenciones/)).toBeInTheDocument()
  })

  it('el historial muestra intervenciones anteriores de otros técnicos', async () => {
    const incident = seedAssigned({ interventions: [intervention()] })
    await openAttention(incident.code)

    const history = screen.getByRole('region', { name: 'Intervenciones técnicas' })
    expect(within(history).getByText('No solucionado')).toBeInTheDocument()
    expect(within(history).getByText('Falta el repuesto.')).toBeInTheDocument()
    expect(within(history).getByText('Fuente de 500 W (ficticio).')).toBeInTheDocument()
  })
})

// --- Verificación y reapertura ---------------------------------------------------

async function openPlanner(code: string) {
  signIn(USERS.multirol)
  const utils = renderApp(`/planificador/incidencias/${code}`)
  await screen.findByRole('heading', { name: 'Cierre técnico' })
  return utils
}

describe('verificación y reapertura del Planificador', () => {
  it('registra la verificación Conforme', async () => {
    const incident = seedClosed()
    const { user } = await openPlanner(incident.code)
    expect(screen.getByText('Pendiente de verificación', { selector: 'dd' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Conforme' }))
    await user.click(screen.getByRole('button', { name: 'Registrar verificación' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Registrar verificación' })).not.toBeInTheDocument(),
    )
    const [request] = attentionBackend.requests.filter((r) => r.path.endsWith('/verification/'))
    expect(request.body).toEqual({ result: 'conforming' })
    expect(request.csrfHeader).toBe(backend.csrfToken)
    expect(screen.getByText(/^Conforme · Luis Prueba/)).toBeInTheDocument()
  })

  it('No conforme exige observaciones y luego permite reabrir con motivo', async () => {
    const incident = seedClosed()
    const { user } = await openPlanner(incident.code)

    await user.click(screen.getByRole('radio', { name: 'No conforme' }))
    await user.click(screen.getByRole('button', { name: 'Registrar verificación' }))
    expect(screen.getByText('Describe por qué la atención no es conforme.')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Observaciones/), 'La falla reapareció.')
    await user.click(screen.getByRole('button', { name: 'Registrar verificación' }))

    const reopen = await screen.findByRole('button', { name: 'Reabrir incidencia' })
    await user.click(reopen)
    expect(screen.getByText(/Indica el motivo de la reapertura/)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Motivo de la reapertura/), 'El usuario reporta la misma falla.')
    await user.click(screen.getByRole('button', { name: 'Reabrir incidencia' }))

    // Tras reabrir, el panel vuelve a la programación para una nueva atención.
    expect(await screen.findByRole('heading', { name: 'Programar atención' })).toBeInTheDocument()
    expect(screen.getAllByText('Reabierta').length).toBeGreaterThan(0)
    const reopenRequest = attentionBackend.requests.find((r) => r.path.endsWith('/reopen/'))
    expect(reopenRequest?.body).toEqual({ reason: 'El usuario reporta la misma falla.' })
  })

  it('la bandeja ofrece las colas de pendientes y por verificar', async () => {
    seedClosed()
    signIn(USERS.multirol)
    const { user } = renderApp('/planificador')

    await user.click(await screen.findByRole('button', { name: /Cerradas por verificar/ }))

    expect(screen.getByRole('button', { name: /Cerradas por verificar/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Pendientes de atención/ })).toBeInTheDocument()
  })
})

// --- Solicitante -----------------------------------------------------------------

describe('vista del solicitante tras el cierre', () => {
  it('ve la fecha de cierre, pero no el historial técnico', async () => {
    incidentsBackend.seed(USERS.solicitante.username, {
      status: 'cerrada',
      status_label: 'Cerrada',
      closed_at: '2026-11-05T15:00:00-05:00',
    })
    signIn(USERS.solicitante)
    renderApp('/solicitante/incidencias/INC-2026-000001')

    expect(await screen.findByRole('heading', { name: 'Atención finalizada' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Intervenciones técnicas' })).not.toBeInTheDocument()
  })
})
