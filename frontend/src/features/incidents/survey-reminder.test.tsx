/**
 * Recordatorio de encuestas pendientes al iniciar sesión (ADR 0012): una y varias
 * encuestas, «Ahora no», navegación, recarga, nueva sesión, cambio de cuenta, usuarios
 * con varias capacidades y cuentas sin permisos. Datos ficticios.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { incidentsBackend } from '../../test/fakeIncidents'
import { defaultSummary, homeBackend } from '../../test/fakeHome'
import { surveyBackend } from '../../test/fakeSurvey'
import { fillLogin, renderApp } from '../../test/renderApp'

type User = (typeof USERS)[keyof typeof USERS]

function closedFor(user: User, count = 1) {
  return Array.from({ length: count }, () => {
    const incident = incidentsBackend.seed(user.username, {
      status: 'cerrada',
      status_label: 'Cerrada',
      closed_at: '2026-11-08T10:00:00-05:00',
      survey_pending: true,
    } as never)
    surveyBackend.pending(incident.code)
    return incident
  })
}

function signIn(user: User) {
  backend.signIn(user)
  document.cookie = `csrftoken=${backend.csrfToken}; path=/`
}

const reminderGets = () => surveyBackend.reminderRequests.filter((r) => r.method === 'GET')

describe('recordatorio al iniciar sesión', () => {
  it('una encuesta pendiente: muestra el ticket con «Ahora no» y «Evaluar atención»', async () => {
    const [incident] = closedFor(USERS.solicitante)
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')

    const dialog = await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })
    expect(within(dialog).getByText(incident.code)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Ahora no' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Evaluar atención' })).toBeInTheDocument()
    // Se marca como mostrado en la sesión, con peticiones pasivas.
    await waitFor(() => expect(surveyBackend.reminderShownIn).toContain(backend.sessionId))
    expect(surveyBackend.reminderRequests.every((r) => r.passive)).toBe(true)
  })

  it('«Evaluar atención» lleva al ticket y abre la encuesta ya implementada', async () => {
    const [incident] = closedFor(USERS.solicitante)
    signIn(USERS.solicitante)
    const { user } = renderApp('/')
    const dialog = await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })

    await user.click(within(dialog).getByRole('button', { name: 'Evaluar atención' }))

    expect(await screen.findByRole('dialog', { name: 'Evalúa tu atención' })).toBeInTheDocument()
    // Con el modal abierto, la página de fondo queda oculta para lectores de pantalla.
    expect(screen.getByRole('heading', { name: incident.code, level: 1, hidden: true })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /pendiente/ })).not.toBeInTheDocument()
  })

  it('«Ahora no» cierra sin responder ni bloquear y la encuesta sigue disponible', async () => {
    closedFor(USERS.solicitante)
    signIn(USERS.solicitante)
    homeBackend.override = { ...defaultSummary(), surveys: { pending: 1 } }
    const { user } = renderApp('/')
    await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })

    await user.click(screen.getByRole('button', { name: 'Ahora no' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(surveyBackend.requests).toHaveLength(0) // ninguna respuesta registrada
    // El acceso permanente sigue en Inicio (indicador de encuestas pendientes).
    expect(await screen.findByRole('link', { name: 'Encuestas pendientes: 1' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Menú principal' })
    await user.click(within(nav).getByRole('link', { name: 'Mis incidencias' }))
    expect(await screen.findByText('Evaluación pendiente')).toBeInTheDocument()
  })

  it('Escape también lo cierra', async () => {
    closedFor(USERS.solicitante)
    signIn(USERS.solicitante)
    const { user } = renderApp('/')
    await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('varias pendientes: un solo modal con la cantidad, la lista breve y acceso a Mis incidencias', async () => {
    const incidents = closedFor(USERS.solicitante, 7)
    signIn(USERS.solicitante)
    const { user } = renderApp('/')

    const dialog = await screen.findByRole('dialog', { name: 'Encuestas de satisfacción pendientes' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(dialog).toHaveTextContent('Tienes 7 atenciones finalizadas pendientes de evaluar.')
    expect(within(dialog).getAllByRole('link')).toHaveLength(5)
    expect(dialog).toHaveTextContent('Y 2 más en Mis incidencias.')
    const firstLink = within(dialog).getByRole('link', { name: `Evaluar atención del ticket ${incidents[6].code}` })
    expect(firstLink).toHaveAttribute('href', `/incidencias/${incidents[6].code}?evaluar=1`)

    await user.click(within(dialog).getByRole('button', { name: 'Ver mis incidencias' }))

    expect(await screen.findByRole('heading', { name: 'Mis incidencias', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('una sola vez por sesión', () => {
  it('no se repite al navegar ni al volver a Inicio', async () => {
    closedFor(USERS.solicitante)
    signIn(USERS.solicitante)
    const { user } = renderApp('/')
    await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })
    await user.click(screen.getByRole('button', { name: 'Ahora no' }))

    const nav = screen.getByRole('navigation', { name: 'Menú principal' })
    await user.click(within(nav).getByRole('link', { name: 'Mis incidencias' }))
    await screen.findByRole('heading', { name: 'Mis incidencias', level: 1 })
    await user.click(within(nav).getByRole('link', { name: 'Inicio' }))
    await screen.findByRole('heading', { name: /Hola/ })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(reminderGets()).toHaveLength(1) // una sola consulta al backend
  })

  it('no se repite al recargar la página en la misma sesión', async () => {
    closedFor(USERS.solicitante)
    signIn(USERS.solicitante)
    const first = renderApp('/')
    await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })
    await waitFor(() => expect(surveyBackend.reminderShownIn).toContain(backend.sessionId))
    first.unmount()

    // Recarga: misma sesión del servidor, la aplicación se monta de nuevo.
    renderApp('/')
    await screen.findByRole('heading', { name: /Hola/ })
    await waitFor(() => expect(reminderGets()).toHaveLength(2))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('vuelve a mostrarse en una nueva sesión si sigue pendiente', async () => {
    closedFor(USERS.solicitante)
    signIn(USERS.solicitante)
    const { user } = renderApp('/')
    await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })
    await user.click(screen.getByRole('button', { name: 'Ahora no' }))

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await screen.findByRole('heading', { name: 'Iniciar sesión' })
    await fillLogin(user, 'ana.prueba')

    expect(await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })).toBeInTheDocument()
  })

  it('al cambiar de cuenta no muestra el recordatorio de la anterior', async () => {
    closedFor(USERS.solicitante)
    signIn(USERS.solicitante)
    const { user } = renderApp('/')
    await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })
    await user.click(screen.getByRole('button', { name: 'Ahora no' }))

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    await screen.findByRole('heading', { name: 'Iniciar sesión' })
    await fillLogin(user, 'tec.uno') // sin encuestas propias

    await screen.findByRole('heading', { name: /Hola, Tomás/ })
    await waitFor(() => expect(reminderGets()).toHaveLength(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('a quién se muestra', () => {
  it('a un trabajador con varias capacidades que tiene incidencias propias', async () => {
    closedFor(USERS.multirol)
    signIn(USERS.multirol)
    renderApp('/planificacion')

    expect(await screen.findByRole('dialog', { name: 'Encuesta de satisfacción pendiente' })).toBeInTheDocument()
  })

  it('no a quien no tiene encuestas pendientes', async () => {
    incidentsBackend.seed(USERS.solicitante.username)
    signIn(USERS.solicitante)
    renderApp('/')

    await screen.findByRole('heading', { name: /Hola, Ana/ })
    await waitFor(() => expect(reminderGets()).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('no a una cuenta exclusivamente administrativa (ni siquiera lo consulta)', async () => {
    signIn(USERS.administrador)
    renderApp('/')

    await screen.findByRole('heading', { name: 'Panel de Administración', level: 1 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(reminderGets()).toHaveLength(0)
  })

  it('no a una cuenta sin roles', async () => {
    signIn(USERS.sinRoles)
    renderApp('/')

    await screen.findByText('Tu cuenta todavía no tiene funciones asignadas')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(reminderGets()).toHaveLength(0)
  })
})
