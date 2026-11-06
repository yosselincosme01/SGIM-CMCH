import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { renderApp } from '../../test/renderApp'
import { getAuthorizedViews, ROLE_VIEWS } from '../auth/roles'

describe('vistas por rol', () => {
  it('usa denominaciones funcionales comprensibles', () => {
    expect(ROLE_VIEWS.map((view) => [view.role, view.label])).toEqual([
      ['solicitante', 'Solicitante'],
      ['planificador', 'Responsable de Área'],
      ['personal_atencion', 'Personal de Atención'],
      ['administrador', 'Administrador'],
    ])
  })

  it('ignora roles que la interfaz no conoce', () => {
    expect(getAuthorizedViews({ roles: ['desconocido', 'solicitante'] })).toHaveLength(1)
  })

  it('un usuario con varios roles ve solo sus vistas autorizadas', async () => {
    backend.signIn(USERS.multirol)
    renderApp('/')

    const list = await screen.findByRole('list', { name: 'Vistas disponibles' })
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Responsable de Área'),
      expect.stringContaining('Personal de Atención'),
    ])
    expect(within(list).queryByText('Solicitante')).not.toBeInTheDocument()
    expect(within(list).queryByText('Administrador')).not.toBeInTheDocument()
  })

  it('cambia de vista sin volver a iniciar sesión', async () => {
    backend.signIn(USERS.multirol)
    const { user } = renderApp('/')

    const switcher = await screen.findByRole('combobox', { name: 'Vista' })
    expect(within(switcher).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Inicio',
      'Responsable de Área',
      'Personal de Atención',
    ])

    await user.selectOptions(switcher, 'Responsable de Área')
    expect(await screen.findByRole('heading', { name: 'Responsable de Área' })).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Vista' }), 'Personal de Atención')
    expect(await screen.findByRole('heading', { name: 'Personal de Atención' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Vista' })).toHaveValue('/personal-atencion')

    expect(backend.requestsTo('/auth/login/')).toHaveLength(0)
  })

  it('con un solo rol no muestra el selector de vistas', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/')

    await screen.findByRole('heading', { name: 'Hola, Ana' })
    expect(screen.queryByRole('combobox', { name: 'Vista' })).not.toBeInTheDocument()
  })

  it('un usuario sin roles recibe una indicación clara', async () => {
    backend.signIn(USERS.sinRoles)
    renderApp('/')

    expect(
      await screen.findByText('Tu cuenta todavía no tiene vistas asignadas'),
    ).toBeInTheDocument()
  })

  it('las páginas de rol no inventan módulos ni permisos de incidencias', async () => {
    backend.signIn(USERS.administrador)
    renderApp('/administrador')

    expect(await screen.findByRole('heading', { name: 'Administrador' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Módulos en preparación' })).toBeInTheDocument()
  })
})

describe('cierre de sesión', () => {
  it('cierra la sesión en el servidor con CSRF y vuelve al login', async () => {
    backend.signIn(USERS.solicitante)
    document.cookie = `csrftoken=${backend.csrfToken}; path=/`
    const { user } = renderApp('/solicitante')

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
