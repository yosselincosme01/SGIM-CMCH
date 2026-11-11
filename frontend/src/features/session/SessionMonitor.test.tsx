import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { backend, IDLE_TIMEOUT, USERS } from '../../test/fakeBackend'
import { renderApp } from '../../test/renderApp'
import { formatCountdown } from './sessionSettings'

function signedIn(expiresIn: number, limit: 'idle' | 'absolute' = 'idle') {
  backend.signIn(USERS.solicitante)
  backend.expiresIn = expiresIn
  backend.limit = limit
}

describe('formato de la cuenta regresiva', () => {
  it.each([
    [125, '2:05'],
    [59, '0:59'],
    [0, '0:00'],
    [-3, '0:00'],
  ])('%s s → %s', (seconds, expected) => {
    expect(formatCountdown(seconds)).toBe(expected)
  })
})

describe('monitor de sesión', () => {
  it('no muestra avisos si falta tiempo suficiente', async () => {
    signedIn(IDLE_TIMEOUT)
    renderApp('/')

    await screen.findByRole('heading', { name: 'Hola, Ana' })
    // Con el equipo cargado, el sondeo rápido de las pruebas puede repetirse antes de
    // comprobarlo: lo importante es que consultó al servidor y no mostró avisos.
    await waitFor(() =>
      expect(backend.requestsTo('/auth/session/').length).toBeGreaterThanOrEqual(1),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('consulta el estado de la sesión solo con peticiones pasivas', async () => {
    signedIn(IDLE_TIMEOUT)
    renderApp('/', { pollIntervalMs: 60 })

    await waitFor(() => expect(backend.requestsTo('/auth/session/').length).toBeGreaterThan(3))

    expect(backend.requestsTo('/auth/session/').every((request) => request.passive)).toBe(true)
    expect(backend.requests.filter((request) => !request.passive)).toHaveLength(0)
  })

  it('el polling no prolonga la inactividad', async () => {
    signedIn(600)
    renderApp('/', { pollIntervalMs: 60 })

    await waitFor(() => expect(backend.requestsTo('/auth/session/').length).toBeGreaterThan(3))

    // El backend simulado solo renueva la inactividad ante peticiones activas.
    expect(backend.expiresIn).toBe(600)
  })

  it('advierte antes de expirar por inactividad y protege la pantalla', async () => {
    signedIn(90)
    renderApp('/')

    const dialog = await screen.findByRole('alertdialog', { name: 'Tu sesión está por expirar' })
    expect(dialog).toHaveTextContent(/se cerrará en 1:(30|29)/)

    const content = screen.getByTestId('protected-content')
    expect(content).toHaveAttribute('inert')
    expect(content).toHaveClass('session-protected--hidden')
    expect(within(dialog).getByRole('button', { name: 'Seguir conectado' })).toHaveFocus()
  })

  it('"Seguir conectado" hace una única petición activa y cierra el aviso', async () => {
    signedIn(90)
    const { user } = renderApp('/')

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Seguir conectado' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const activeMe = backend.requestsTo('/auth/me/').filter((request) => !request.passive)
    expect(activeMe).toHaveLength(1)
    expect(screen.getByTestId('protected-content')).not.toHaveAttribute('inert')
  })

  it('advierte del límite absoluto sin ofrecer prolongar la sesión', async () => {
    signedIn(60, 'absolute')
    const { user } = renderApp('/')

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Tu sesión llegará a su duración máxima',
    })
    expect(within(dialog).queryByRole('button', { name: 'Seguir conectado' })).toBeNull()
    expect(dialog).toHaveTextContent('tendrás que iniciar sesión nuevamente')

    await user.click(within(dialog).getByRole('button', { name: 'Entendido' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('al llegar a cero consulta al servidor y, si expiró, oculta todo y redirige al login', async () => {
    signedIn(1)
    backend.expireAfterStatusChecks = 1 // la segunda consulta responde 401 session_expired
    renderApp('/incidencias')

    expect(await screen.findByRole('heading', { name: 'Mis incidencias', level: 1 })).toBeInTheDocument()

    expect(
      await screen.findByText('Tu sesión se cerró por inactividad', {}, { timeout: 4000 }),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mis incidencias', level: 1 })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('el backend decide: si la sesión sigue vigente al llegar a cero, no se cierra', async () => {
    signedIn(1)
    renderApp('/')

    await screen.findByRole('alertdialog')
    // Otra pestaña renovó la sesión: el servidor informa más tiempo.
    backend.expiresIn = IDLE_TIMEOUT

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(), {
      timeout: 4000,
    })
    expect(screen.getByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument()
  })

  it('cualquier 401 session_expired durante el uso cierra la sesión local', async () => {
    signedIn(90)
    const { user } = renderApp('/')

    const dialog = await screen.findByRole('alertdialog')
    backend.expiredReason = 'absolute'
    await user.click(within(dialog).getByRole('button', { name: 'Seguir conectado' }))

    expect(
      await screen.findByText('Tu sesión alcanzó la duración máxima permitida'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument()
  })

  it('mantiene el foco dentro del aviso al navegar con teclado', async () => {
    signedIn(90)
    const { user } = renderApp('/')

    const dialog = await screen.findByRole('alertdialog')
    const [first, last] = within(dialog).getAllByRole('button')
    expect(first).toHaveFocus()

    await user.tab()
    expect(last).toHaveFocus()
    await user.tab()
    expect(first).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
  })
})
