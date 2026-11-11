import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { fillLogin, renderApp } from '../../test/renderApp'
import { safeRedirectTarget } from './redirect'

describe('rutas protegidas', () => {
  it('sin sesión, redirige al login y después vuelve a la ruta pedida', async () => {
    const { user } = renderApp('/incidencias')

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()

    await fillLogin(user, 'ana.prueba')

    expect(await screen.findByRole('heading', { name: 'Mis incidencias', level: 1 })).toBeInTheDocument()
  })

  it('restaura la sesión al recargar con una petición pasiva', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument()
    const me = backend.requestsTo('/auth/me/')
    expect(me).toHaveLength(1)
    expect(me[0].passive).toBe(true) // recargar la página no renueva la inactividad
    expect(backend.requestsTo('/auth/login/')).toHaveLength(0)
  })

  it('muestra "Verificando sesión" mientras restaura el estado', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/')

    expect(screen.getByRole('heading', { name: 'Verificando sesión…' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument()
  })

  it('si la sesión expiró antes de recargar, lo informa en el login', async () => {
    backend.signIn(USERS.solicitante)
    backend.expiredReason = 'idle'
    renderApp('/')

    expect(await screen.findByText('Tu sesión se cerró por inactividad')).toBeInTheDocument()
  })

  it('si el servidor no responde al cargar, permite reintentar', async () => {
    backend.networkDown = true
    const { user } = renderApp('/')

    expect(
      await screen.findByRole('heading', { name: 'No se pudo conectar con el servidor' }),
    ).toBeInTheDocument()

    backend.networkDown = false
    backend.signIn(USERS.solicitante)
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument()
  })

  it('una vista de otro rol muestra "sin acceso"', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/administracion')

    expect(
      await screen.findByRole('heading', { name: 'No tienes acceso a esta vista' }),
    ).toBeInTheDocument()
  })

  it('una ruta inexistente muestra "página no encontrada"', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/no-existe')

    expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument()
  })
})

describe('redirección segura tras el login', () => {
  it.each([
    ['/incidencias', '/incidencias'],
    ['/planificacion?x=1', '/planificacion?x=1'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    ['/login', '/'],
    [undefined, '/'],
    [42, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeRedirectTarget(input)).toBe(expected)
  })
})
