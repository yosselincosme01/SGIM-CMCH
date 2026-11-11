/**
 * Encuesta de satisfacción del solicitante (ADR 0012): invitación, modal accesible,
 * envío, errores, historial y visibilidad para el personal autorizado. Datos ficticios.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { incidentsBackend } from '../../test/fakeIncidents'
import { surveyBackend } from '../../test/fakeSurvey'
import { renderApp } from '../../test/renderApp'

function closedIncident() {
  const incident = incidentsBackend.seed(USERS.solicitante.username, {
    status: 'cerrada',
    status_label: 'Cerrada',
    closed_at: '2026-11-08T10:00:00-05:00',
  })
  surveyBackend.pending(incident.code)
  return incident
}

async function openDetail(code: string) {
  backend.signIn(USERS.solicitante)
  // Estas pruebas cubren la encuesta en el detalle: el recordatorio al iniciar sesión ya
  // se mostró en esta sesión (tiene sus propias pruebas en survey-reminder.test.tsx).
  surveyBackend.reminderShownIn.push(backend.sessionId)
  // Como en el navegador: Django deja la cookie CSRF y el cliente la envía en la cabecera.
  document.cookie = `csrftoken=${backend.csrfToken}; path=/`
  const utils = renderApp(`/incidencias/${code}`)
  await screen.findByRole('heading', { name: code, level: 1 })
  return utils
}

const INVITE = 'Tu atención fue finalizada. ¿Deseas evaluar el servicio recibido?'

describe('invitación a evaluar', () => {
  it('aparece tras el cierre técnico, sin abrir el modal automáticamente', async () => {
    const incident = closedIncident()
    await openDetail(incident.code)

    expect(await screen.findByText(INVITE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Evaluar atención' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('no aparece si no hay un cierre pendiente de evaluar', async () => {
    const incident = incidentsBackend.seed(USERS.solicitante.username)
    await openDetail(incident.code)

    await waitFor(() => expect(surveyBackend.requests).toHaveLength(0))
    expect(screen.queryByText(INVITE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Evaluar atención' })).not.toBeInTheDocument()
  })
})

describe('modal de evaluación', () => {
  it('muestra el título, el ticket, la pregunta y estrellas etiquetadas; enviar empieza deshabilitado', async () => {
    const incident = closedIncident()
    const { user } = await openDetail(incident.code)

    await user.click(await screen.findByRole('button', { name: 'Evaluar atención' }))

    const dialog = screen.getByRole('dialog', { name: 'Evalúa tu atención' })
    expect(within(dialog).getByText(incident.code)).toBeInTheDocument()
    const group = within(dialog).getByRole('group', {
      name: /¿Qué tan satisfecho estás con la atención recibida\?/,
    })
    const stars = within(group).getAllByRole('radio')
    expect(stars).toHaveLength(5)
    expect(within(group).getByRole('radio', { name: '1 estrella: Muy insatisfecho' })).toBeInTheDocument()
    expect(within(group).getByRole('radio', { name: '5 estrellas: Muy satisfecho' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Comentario/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Enviar evaluación' })).toBeDisabled()
    expect(stars[0]).toHaveFocus() // el foco entra al modal
  })

  it('«Ahora no» cierra sin enviar y la encuesta sigue disponible', async () => {
    const incident = closedIncident()
    const { user } = await openDetail(incident.code)
    const open = await screen.findByRole('button', { name: 'Evaluar atención' })

    await user.click(open)
    await user.click(screen.getByRole('button', { name: 'Ahora no' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(surveyBackend.requests).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Evaluar atención' })).toHaveFocus()
  })

  it('Escape cierra el modal y devuelve el foco', async () => {
    const incident = closedIncident()
    const { user } = await openDetail(incident.code)

    await user.click(await screen.findByRole('button', { name: 'Evaluar atención' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Evaluar atención' })).toHaveFocus()
  })

  it('se califica con el teclado y se envía con comentario opcional', async () => {
    const incident = closedIncident()
    const { user } = await openDetail(incident.code)
    await user.click(await screen.findByRole('button', { name: 'Evaluar atención' }))

    // Flechas sobre el grupo de estrellas (radios nativos).
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(screen.getByText('4 de 5: Satisfecho')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Comentario/), 'Atención rápida y clara.')
    await user.click(screen.getByRole('button', { name: 'Enviar evaluación' }))

    expect(await screen.findByText('Gracias. Registramos tu evaluación.')).toBeInTheDocument()
    expect(surveyBackend.requests[0]).toEqual({
      body: { closure: 41, rating: 4, comment: 'Atención rápida y clara.' },
      csrfHeader: backend.csrfToken,
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(INVITE)).not.toBeInTheDocument()
    const history = screen.getByRole('region', { name: 'Tus evaluaciones' })
    expect(within(history).getByLabelText('4 de 5 estrellas')).toBeInTheDocument()
    expect(within(history).getByText('Atención rápida y clara.')).toBeInTheDocument()
  })

  it('el comentario es opcional', async () => {
    const incident = closedIncident()
    const { user } = await openDetail(incident.code)
    await user.click(await screen.findByRole('button', { name: 'Evaluar atención' }))

    await user.click(screen.getByRole('radio', { name: '5 estrellas: Muy satisfecho' }))
    await user.click(screen.getByRole('button', { name: 'Enviar evaluación' }))

    await screen.findByText('Gracias. Registramos tu evaluación.')
    expect(surveyBackend.requests[0].body).toEqual({ closure: 41, rating: 5, comment: '' })
  })

  it('si el cierre ya fue evaluado (409) lo explica y no duplica', async () => {
    const incident = closedIncident()
    surveyBackend.nextError = { status: 409, body: { detail: 'Este cierre técnico ya fue evaluado.' } }
    const { user } = await openDetail(incident.code)
    await user.click(await screen.findByRole('button', { name: 'Evaluar atención' }))

    await user.click(screen.getByRole('radio', { name: '3 estrellas: Neutral' }))
    await user.click(screen.getByRole('button', { name: 'Enviar evaluación' }))

    expect(await screen.findByText('Este cierre técnico ya fue evaluado.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('muestra los errores de validación del servidor', async () => {
    const incident = closedIncident()
    surveyBackend.nextError = {
      status: 400,
      body: { comment: ['El comentario no puede superar 1000 caracteres.'] },
    }
    const { user } = await openDetail(incident.code)
    await user.click(await screen.findByRole('button', { name: 'Evaluar atención' }))

    await user.click(screen.getByRole('radio', { name: '2 estrellas: Insatisfecho' }))
    await user.click(screen.getByRole('button', { name: 'Enviar evaluación' }))

    expect(
      await screen.findByText('El comentario no puede superar 1000 caracteres.'),
    ).toBeInTheDocument()
  })
})

describe('modal en móviles', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('funciona igual con el ancho de un teléfono', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({ matches: query.includes('max-width'), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
    )
    const incident = closedIncident()
    const { user } = await openDetail(incident.code)

    await user.click(await screen.findByRole('button', { name: 'Evaluar atención' }))
    await user.click(screen.getByRole('radio', { name: '4 estrellas: Satisfecho' }))
    await user.click(screen.getByRole('button', { name: 'Enviar evaluación' }))

    expect(await screen.findByText('Gracias. Registramos tu evaluación.')).toBeInTheDocument()
  })
})

describe('historial y Mis incidencias', () => {
  it('una evaluación ya respondida se consulta sin poder duplicarla', async () => {
    const incident = incidentsBackend.seed(USERS.solicitante.username, {
      status: 'cerrada',
      status_label: 'Cerrada',
      closed_at: '2026-11-08T10:00:00-05:00',
    })
    surveyBackend.states[incident.code] = {
      pending: null,
      history: [
        {
          closure: 7,
          closed_at: '2026-11-08T10:00:00-05:00',
          rating: 2,
          comment: 'Tardó en llegar.',
          created_at: '2026-11-08T12:00:00-05:00',
        },
      ],
    }
    await openDetail(incident.code)

    const history = await screen.findByRole('region', { name: 'Tus evaluaciones' })
    expect(within(history).getByLabelText('2 de 5 estrellas')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Evaluar atención' })).not.toBeInTheDocument()
  })

  it('Mis incidencias marca las evaluaciones pendientes', async () => {
    incidentsBackend.seed(USERS.solicitante.username, { survey_pending: true } as never)
    incidentsBackend.seed(USERS.solicitante.username)
    backend.signIn(USERS.solicitante)
    renderApp('/incidencias')

    const table = await screen.findByRole('table')
    expect(within(table).getAllByText('Evaluación pendiente')).toHaveLength(1)
  })
})
