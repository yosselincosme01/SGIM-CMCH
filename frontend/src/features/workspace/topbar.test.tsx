/**
 * Barra superior institucional: control compacto del menú, avatar con la inicial y
 * menú de perfil (Ver perfil, Cerrar sesión). Datos ficticios.
 */
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { renderApp } from '../../test/renderApp'
import { userInitial } from './userInitial'

async function openApp(user: (typeof USERS)[keyof typeof USERS], route = '/') {
  backend.signIn(user)
  document.cookie = `csrftoken=${backend.csrfToken}; path=/`
  const utils = renderApp(route)
  await screen.findByRole('navigation', { name: 'Menú principal' })
  return utils
}

describe('inicial del avatar', () => {
  it('usa el nombre, luego el nombre completo y luego el usuario', () => {
    expect(userInitial({ first_name: 'ana', full_name: 'Ana Prueba', username: 'ana.prueba' })).toBe('A')
    expect(userInitial({ first_name: ' ', full_name: 'Úrsula Prueba', username: 'u' })).toBe('Ú')
    expect(userInitial({ first_name: '', full_name: '', username: 'sin.roles' })).toBe('S')
  })
})

describe('barra superior', () => {
  it('mantiene identidad y avatar; sin botón de menú en escritorio ni nombre o «Cerrar sesión» sueltos', async () => {
    await openApp(USERS.solicitante)

    const banner = document.querySelector('header.topbar') as HTMLElement
    expect(within(banner).getByRole('link', { name: 'SGIM-CMCH, ir al inicio' })).toHaveTextContent(
      'Sistema de Gestión de Incidencias y Mantenimiento',
    )
    expect(within(banner).queryByRole('button', { name: /menú$/i })).not.toBeInTheDocument()
    const avatar = within(banner).getByRole('button', { name: 'Menú de perfil de Ana Prueba' })
    expect(avatar).toHaveTextContent('A')
    expect(avatar).toHaveAttribute('aria-expanded', 'false')
    expect(within(banner).queryByRole('button', { name: 'Cerrar sesión' })).not.toBeInTheDocument()
    expect(within(banner).queryByText('Ana Prueba')).not.toBeVisible()
  })

  it('es la misma barra para cualquier cuenta', async () => {
    await openApp(USERS.administrador)

    const banner = document.querySelector('header.topbar') as HTMLElement
    expect(within(banner).getByRole('button', { name: 'Menú de perfil de Eva Prueba' })).toHaveTextContent('E')
    expect(within(banner).queryByRole('button', { name: /menú$/i })).not.toBeInTheDocument()
  })

  it('en tabletas y móviles muestra el botón compacto para abrir y cerrar el menú', async () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({ matches: query.includes('max-width'), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
    )
    try {
      backend.signIn(USERS.solicitante)
      const { user } = renderApp('/')
      await screen.findByRole('heading', { name: /Hola, Ana/ })
      const banner = document.querySelector('header.topbar') as HTMLElement
      const toggle = within(banner).getByRole('button', { name: 'Abrir menú' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(toggle).toHaveAttribute('aria-controls', 'menu-principal')
      expect(toggle).toHaveTextContent('') // solo icono

      await user.click(toggle)

      expect(within(banner).getByRole('button', { name: 'Cerrar menú' })).toHaveAttribute('aria-expanded', 'true')
      expect(within(banner).getByRole('button', { name: /Menú de perfil/ })).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('menú de perfil', () => {
  it('muestra el nombre, «Ver perfil» y «Cerrar sesión», con el foco en la primera opción', async () => {
    const { user } = await openApp(USERS.multirol)
    const avatar = screen.getByRole('button', { name: /Menú de perfil/ })

    await user.click(avatar)

    expect(avatar).toHaveAttribute('aria-expanded', 'true')
    const panel = document.getElementById(avatar.getAttribute('aria-controls')!)!
    expect(panel).toBeVisible()
    expect(within(panel).getByText('Luis Prueba')).toBeInTheDocument()
    expect(within(panel).getByText('luis.prueba')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'Ver perfil' })).toHaveFocus()
    expect(within(panel).getByRole('link', { name: 'Ver perfil' })).toHaveAttribute('href', '/mi-cuenta')
    expect(within(panel).getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument()
  })

  it('Escape lo cierra y devuelve el foco al avatar', async () => {
    const { user } = await openApp(USERS.solicitante)
    const avatar = screen.getByRole('button', { name: /Menú de perfil/ })
    await user.click(avatar)

    await user.keyboard('{Escape}')

    expect(avatar).toHaveAttribute('aria-expanded', 'false')
    expect(avatar).toHaveFocus()
  })

  it('se cierra al hacer clic fuera', async () => {
    const { user } = await openApp(USERS.solicitante)
    const avatar = screen.getByRole('button', { name: /Menú de perfil/ })
    await user.click(avatar)

    fireEvent.mouseDown(screen.getByRole('main'))

    expect(avatar).toHaveAttribute('aria-expanded', 'false')
  })

  it('se abre con el teclado y se cierra al salir con Tab', async () => {
    const { user } = await openApp(USERS.solicitante)
    const avatar = screen.getByRole('button', { name: /Menú de perfil/ })
    avatar.focus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('link', { name: 'Ver perfil' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toHaveFocus()
    await user.tab()

    expect(avatar).toHaveAttribute('aria-expanded', 'false')
  })

  it('«Ver perfil» abre Mi cuenta y cierra el menú', async () => {
    const { user } = await openApp(USERS.solicitante)
    await user.click(screen.getByRole('button', { name: /Menú de perfil/ }))

    await user.click(screen.getByRole('link', { name: 'Ver perfil' }))

    expect(await screen.findByRole('heading', { name: 'Mi cuenta', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Menú de perfil/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('«Cerrar sesión» usa el flujo seguro existente (CSRF) y vuelve al login', async () => {
    const { user } = await openApp(USERS.solicitante)
    await user.click(screen.getByRole('button', { name: /Menú de perfil/ }))

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }))

    expect(await screen.findByText('Cerraste sesión correctamente')).toBeInTheDocument()
    const logout = backend.requestsTo('/auth/logout/', 'POST')
    expect(logout).toHaveLength(1)
    expect(logout[0].csrfHeader).toBe(backend.csrfToken)
    expect(backend.sessionUser).toBeNull()
  })
})
