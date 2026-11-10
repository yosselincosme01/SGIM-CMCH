import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { renderApp } from '../../test/renderApp'

describe('cierre de sesión', () => {
  it('cierra la sesión en el servidor con CSRF y vuelve al login', async () => {
    backend.signIn(USERS.solicitante)
    document.cookie = `csrftoken=${backend.csrfToken}; path=/`
    const { user } = renderApp('/incidencias')

    await user.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))

    expect(await screen.findByText('Cerraste sesión correctamente')).toBeInTheDocument()
    const logout = backend.requestsTo('/auth/logout/', 'POST')
    expect(logout).toHaveLength(1)
    expect(logout[0].csrfHeader).toBe('csrf-inicial')
    expect(backend.sessionUser).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Solicitante' })).not.toBeInTheDocument()
    expect(localStorage).toHaveLength(0)
    expect(sessionStorage).toHaveLength(0)
  })

  it('si el servidor no responde, borra igualmente la sesión local y lo advierte', async () => {
    backend.signIn(USERS.solicitante)
    const { user } = renderApp('/')

    await screen.findByRole('heading', { name: 'Hola, Ana' })
    backend.networkDown = true
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(await screen.findByText('Cerramos la sesión en este equipo')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Hola, Ana' })).not.toBeInTheDocument()
  })

  it('un cierre de sesión en otra pestaña oculta el contenido en esta', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/')
    await screen.findByRole('heading', { name: 'Hola, Ana' })

    const otherTab = new BroadcastChannel('sgim-auth')
    otherTab.postMessage({ type: 'signed-out' })
    otherTab.close()

    expect(
      await screen.findByText('La sesión se cerró en otra pestaña de este navegador.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Hola, Ana' })).not.toBeInTheDocument()
  })
})
