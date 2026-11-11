import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { formatDateTime, isPastLimaInput, limaToday, toLimaInputValue } from '../../shared/dates'
import { backend, USERS } from '../../test/fakeBackend'
import { incidentsBackend } from '../../test/fakeIncidents'
import { planningBackend } from '../../test/fakePlanning'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const FUTURE = '2030-01-15T09:30'

function signInPlanner() {
  backend.signIn(USERS.multirol) // planificador + personal_atencion
  document.cookie = `csrftoken=${backend.csrfToken}; path=/`
}

function writes() {
  return planningBackend.requests.filter((request) => request.method !== 'GET')
}

async function openDetail(code: string) {
  signInPlanner()
  const utils = renderApp(`/planificacion/incidencias/${code}`)
  await screen.findByRole('heading', { name: code })
  await screen.findByRole('heading', { name: /Programar atención|Reprogramar atención/ })
  return utils
}

describe('fechas en hora de Lima', () => {
  it('presenta e interpreta las fechas en America/Lima, sin depender del navegador', () => {
    // 03:00 UTC del 6 de noviembre son las 22:00 del 5 de noviembre en Lima.
    expect(toLimaInputValue('2026-11-06T03:00:00Z')).toBe('2026-11-05T22:00')
    expect(formatDateTime('2026-11-06T03:00:00Z')).toMatch(/5 nov.*10:00\s*p/)
    expect(limaToday(new Date('2026-11-06T03:00:00Z'))).toBe('2026-11-05')
    expect(isPastLimaInput('2026-11-05T21:59', new Date('2026-11-06T03:00:00Z'))).toBe(true)
    expect(isPastLimaInput('2026-11-05T22:00', new Date('2026-11-06T03:00:00Z'))).toBe(false)
  })
})

describe('denominación y navegación', () => {
  it('la función se muestra como "Planificación", sin el nombre interno del rol', async () => {
    signInPlanner()
    renderApp('/')

    const nav = await screen.findByRole('navigation', { name: 'Menú principal' })
    expect(within(nav).getByRole('link', { name: 'Planificación' })).toHaveAttribute(
      'href',
      '/planificacion',
    )
    expect(screen.queryByText(/Planificador/)).not.toBeInTheDocument()
  })

  it('la ruta anterior redirige a /planificacion conservando el resto de la ruta', async () => {
    const incident = planningBackend.seed()
    signInPlanner()
    renderApp(`/responsable-area/incidencias/${incident.code}`)

    expect(await screen.findByRole('heading', { name: incident.code })).toBeInTheDocument()
  })

  it('la ruta anterior sin subruta abre la bandeja', async () => {
    signInPlanner()
    renderApp('/responsable-area')

    expect(await screen.findByRole('heading', { name: 'Planificación', level: 1 })).toBeInTheDocument()
  })

  it('sin la función de planificar la vista no está disponible', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/planificacion')

    expect(
      await screen.findByRole('heading', { name: 'No tienes acceso a esta vista' }),
    ).toBeInTheDocument()
  })
})

describe('Planificación', () => {
  it('lista las incidencias con prioridad en texto, estado y técnico', async () => {
    planningBackend.seed()
    planningBackend.seed({ priority: { code: 'alta', name: 'Alta', order: 2, description: '', is_provisional: true } })
    signInPlanner()
    renderApp('/planificacion')

    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Sin prioridad')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Alta')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Sin asignar')).toBeInTheDocument()
    expect(within(rows[0]).getByRole('link', { name: /Planificar INC-/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/planificacion\/incidencias\/INC-/),
    )
    expect(screen.getByText(/Niveles de prioridad provisionales/)).toBeInTheDocument()
  })

  it('el indicador "Sin prioridad" filtra la bandeja', async () => {
    planningBackend.seed()
    signInPlanner()
    const { user } = renderApp('/planificacion')

    await user.click(await screen.findByRole('button', { name: /Sin prioridad/ }))

    await waitFor(() =>
      expect(
        planningBackend.requests.some(
          (request) => request.path.endsWith('/planning/') && request.method === 'GET',
        ),
      ).toBe(true),
    )
    expect(screen.getByRole('button', { name: /Sin prioridad/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('sin áreas autorizadas lo informa sin mostrar incidencias', async () => {
    server.use(
      http.get('*/api/v1/incidents/planning/options/', () =>
        HttpResponse.json({
          areas: [],
          priorities: [],
          counts: { unprioritized: 0, unassigned: 0, scheduled_today: 0 },
        }),
      ),
    )
    signInPlanner()
    renderApp('/planificacion')

    expect(
      await screen.findByRole('heading', { name: 'No tienes áreas habilitadas para planificar' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('muestra un estado vacío', async () => {
    signInPlanner()
    renderApp('/planificacion')

    expect(await screen.findByRole('heading', { name: 'No hay incidencias' })).toBeInTheDocument()
  })
})

describe('programación de la atención', () => {
  it('solo ofrece técnicos autorizados que entrega el backend', async () => {
    const incident = planningBackend.seed()
    await openDetail(incident.code)

    const select = screen.getByLabelText(/Técnico responsable/)
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual([
      'Selecciona un técnico',
      'Tomás Prueba · 2 asignaciones vigentes',
      'Rosa Prueba · 0 asignaciones vigentes',
    ])
  })

  it('valida los datos obligatorios sin enviar nada', async () => {
    const incident = planningBackend.seed()
    const { user } = await openDetail(incident.code)

    await user.click(screen.getByRole('button', { name: 'Programar atención' }))

    expect(screen.getByText('Selecciona la prioridad.')).toBeInTheDocument()
    expect(screen.getByText('Selecciona el técnico responsable.')).toBeInTheDocument()
    expect(screen.getByText('Indica la fecha y hora estimada de atención.')).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
  })

  it('no permite programar en el pasado', async () => {
    const incident = planningBackend.seed()
    const { user } = await openDetail(incident.code)
    await user.click(screen.getByRole('radio', { name: 'Alta' }))
    await user.selectOptions(screen.getByLabelText(/Técnico responsable/), 'tec.dos')
    fireEvent.change(screen.getByLabelText(/Fecha y hora estimada/), {
      target: { value: '2020-01-01T08:00' },
    })

    await user.click(screen.getByRole('button', { name: 'Programar atención' }))

    expect(
      screen.getByText('La fecha y hora de atención no puede estar en el pasado.'),
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
  })

  it('programa con CSRF y petición activa, sin enviar estado ni autor', async () => {
    const incident = planningBackend.seed()
    const { user } = await openDetail(incident.code)
    await user.click(screen.getByRole('radio', { name: 'Crítica' }))
    await user.selectOptions(screen.getByLabelText(/Técnico responsable/), 'tec.dos')
    fireEvent.change(screen.getByLabelText(/Fecha y hora estimada/), { target: { value: FUTURE } })
    await user.type(screen.getByLabelText(/Indicaciones internas/), 'Llevar cable de red')

    await user.click(screen.getByRole('button', { name: 'Programar atención' }))

    expect(await screen.findByText(/Atención programada. La incidencia quedó asignada/)).toBeInTheDocument()
    const [request] = writes()
    expect(request.path).toBe(`/api/v1/incidents/${incident.code}/planning/`)
    expect(request.body).toEqual({
      priority: 'critica',
      technician: 'tec.dos',
      scheduled_at: FUTURE, // hora de Lima, sin zona: la interpreta el backend
      expected_assignment: null,
      notes: 'Llevar cable de red',
    })
    expect(request.csrfHeader).toBe(backend.csrfToken)
    expect(request.passive).toBe(false)
    expect(screen.getByRole('heading', { name: 'Reprogramar atención' })).toBeInTheDocument()
    expect(screen.getAllByText('Asignada').length).toBeGreaterThan(0)
    expect(screen.getByText(/Técnico responsable: Rosa Prueba/)).toBeInTheDocument()
  })

  it('permite establecer la prioridad antes de programar', async () => {
    const incident = planningBackend.seed()
    const { user } = await openDetail(incident.code)
    await user.click(screen.getByRole('radio', { name: 'Media' }))

    await user.click(screen.getByRole('button', { name: 'Guardar solo prioridad' }))

    expect(await screen.findByText(/Prioridad actualizada y registrada/)).toBeInTheDocument()
    expect(writes()).toEqual([
      expect.objectContaining({
        method: 'PUT',
        path: `/api/v1/incidents/${incident.code}/priority/`,
        body: { priority: 'media' },
        csrfHeader: backend.csrfToken,
        passive: false,
      }),
    ])
    expect(screen.getByText('Prioridad: Sin prioridad → Media')).toBeInTheDocument()
  })

  it('informa si el área no tiene técnicos autorizados', async () => {
    planningBackend.technicians = []
    const incident = planningBackend.seed()
    await openDetail(incident.code)

    expect(screen.getByText('No hay técnicos autorizados en esta área')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Programar atención' })).toBeDisabled()
  })

  it('sin permiso de planificar muestra la información sin formulario', async () => {
    const incident = planningBackend.seed({
      permissions: { can_plan: false, can_intervene: false, can_verify: false, can_reopen: false },
    })
    signInPlanner()
    renderApp(`/planificacion/incidencias/${incident.code}`)

    expect(
      await screen.findByText('No puedes planificar esta incidencia en su estado actual.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Programar atención' })).not.toBeInTheDocument()
  })

  it('muestra los errores del servidor en sus campos', async () => {
    planningBackend.serverErrors = {
      technician: ['La persona seleccionada no es técnico autorizado de esta área.'],
    }
    const incident = planningBackend.seed()
    const { user } = await openDetail(incident.code)
    await user.click(screen.getByRole('radio', { name: 'Alta' }))
    await user.selectOptions(screen.getByLabelText(/Técnico responsable/), 'tec.uno')
    fireEvent.change(screen.getByLabelText(/Fecha y hora estimada/), { target: { value: FUTURE } })

    await user.click(screen.getByRole('button', { name: 'Programar atención' }))

    expect(
      await screen.findByText('La persona seleccionada no es técnico autorizado de esta área.'),
    ).toBeInTheDocument()
  })
})

describe('reprogramación y reasignación', () => {
  function seedAssigned() {
    return planningBackend.seed({
      status: 'asignada',
      status_label: 'Asignada',
      priority: { code: 'alta', name: 'Alta', order: 2, description: '', is_provisional: true },
      assignment: {
        id: 7,
        technician: { username: 'tec.uno', full_name: 'Tomás Prueba' },
        assigned_by: { username: 'luis.prueba', full_name: 'Luis Prueba' },
        scheduled_at: '2030-01-10T09:00:00-05:00',
        notes: 'Indicación previa',
        created_at: '2026-11-03T15:00:00Z',
      },
    })
  }

  it('exige el motivo antes de reprogramar', async () => {
    const incident = seedAssigned()
    const { user } = await openDetail(incident.code)
    await user.selectOptions(screen.getByLabelText(/Técnico responsable/), 'tec.dos')

    await user.click(screen.getByRole('button', { name: 'Guardar reprogramación' }))

    expect(
      screen.getByText('Indica el motivo del cambio (al menos 10 caracteres).'),
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
  })

  it('pide confirmar mostrando los valores anteriores y nuevos, y registra el cambio', async () => {
    const incident = seedAssigned()
    const { user } = await openDetail(incident.code)
    expect(screen.getByLabelText(/Fecha y hora estimada/)).toHaveValue('2030-01-10T09:00')
    await user.selectOptions(screen.getByLabelText(/Técnico responsable/), 'tec.dos')
    await user.type(screen.getByLabelText(/Motivo de la reprogramación/), 'El técnico está de licencia')

    await user.click(screen.getByRole('button', { name: 'Guardar reprogramación' }))
    const dialog = await screen.findByRole('dialog', { name: 'Confirmar reprogramación' })
    expect(within(dialog).getByText('Tomás Prueba → Rosa Prueba')).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar cambios' }))

    expect(await screen.findByText(/Reprogramación guardada/)).toBeInTheDocument()
    expect(writes()[0].body).toEqual({
      priority: 'alta',
      technician: 'tec.dos',
      scheduled_at: '2030-01-10T09:00',
      expected_assignment: 7,
      notes: 'Indicación previa',
      reason: 'El técnico está de licencia',
    })
    expect(screen.getByText('Técnico responsable: Tomás Prueba → Rosa Prueba')).toBeInTheDocument()
    expect(screen.getByText('Motivo: El técnico está de licencia')).toBeInTheDocument()
  })

  it('si otra persona cambió la incidencia (409) avisa y conserva lo escrito', async () => {
    planningBackend.conflictNext = true
    const incident = seedAssigned()
    const { user } = await openDetail(incident.code)
    await user.selectOptions(screen.getByLabelText(/Técnico responsable/), 'tec.dos')
    await user.type(screen.getByLabelText(/Motivo de la reprogramación/), 'Cambio por disponibilidad')
    await user.click(screen.getByRole('button', { name: 'Guardar reprogramación' }))
    await user.click(await screen.findByRole('button', { name: 'Confirmar cambios' }))

    expect(await screen.findByText(/Otra persona actualizó esta incidencia/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Motivo de la reprogramación/)).toHaveValue(
      'Cambio por disponibilidad',
    )
  })
})

describe('vista del solicitante', () => {
  it('ve la fecha estimada de atención, pero no datos internos', async () => {
    incidentsBackend.seed(USERS.solicitante.username, {
      status: 'asignada',
      status_label: 'Asignada',
      scheduled_at: '2030-01-15T09:30:00-05:00',
    })
    backend.signIn(USERS.solicitante)
    renderApp('/incidencias/INC-2026-000001')

    expect(await screen.findByTestId('scheduled-at')).toHaveTextContent(/15 ene.*9:30\s*a/)
    expect(screen.queryByText(/Indicaciones internas/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Técnico responsable/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Prioridad/)).not.toBeInTheDocument()
  })
})
