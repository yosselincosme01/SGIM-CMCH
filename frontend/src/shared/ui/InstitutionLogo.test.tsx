import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import css from '../../styles/index.css?raw'
import { renderApp } from '../../test/renderApp'

const ALT = 'Clínica Médica Cayetano Heredia'

/** Barra superior de las vistas internas (el <header> que contiene el logotipo). */
async function findTopbar(): Promise<HTMLElement> {
  const brand = await screen.findByTestId('topbar-brand')
  const header = brand.closest('header')
  if (!header) throw new Error('El logotipo no está dentro de la barra superior.')
  return header
}

function logos() {
  return screen.queryAllByRole('img', { name: ALT })
}

describe('logotipo institucional en el login', () => {
  it('usa solo el archivo con fondo blanco', async () => {
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Iniciar sesión' })

    const images = logos()
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('data-variant', 'on-white')
    expect(images[0].getAttribute('src')).toContain('Logo-CMCH-fondo-blanco')
  })

  it('está fuera de la tarjeta y del formulario, en el layout de la página', async () => {
    renderApp('/login')
    const card = (await screen.findByRole('heading', { name: 'Iniciar sesión' })).closest(
      'section',
    )
    const logo = logos()[0]

    expect(card).not.toBeNull()
    expect(card).not.toContainElement(logo)
    expect(logo.closest('form')).toBeNull()
    expect(within(screen.getByTestId('login-brand')).getByRole('img')).toBe(logo)
  })

  it('la tarjeta conserva la identificación textual del sistema', async () => {
    renderApp('/login')
    const card = (await screen.findByRole('heading', { name: 'Iniciar sesión' })).closest(
      'section',
    ) as HTMLElement

    expect(within(card).getByText('SGIM-CMCH')).toBeInTheDocument()
    expect(
      within(card).getByText('Sistema de Gestión de Incidencias y Mantenimiento'),
    ).toBeInTheDocument()
    expect(within(card).queryByRole('img')).toBeNull()
  })
})

describe('logotipo institucional en las vistas internas', () => {
  it.each([
    ['/solicitante', USERS.solicitante],
    ['/administrador', USERS.administrador],
    ['/planificador', USERS.multirol],
    ['/personal-atencion', USERS.multirol],
  ])('%s usa la barra guinda con el logotipo de fondo guinda', async (route, user) => {
    backend.signIn(user)
    renderApp(route)
    const banner = await findTopbar()
    const images = logos()
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('data-variant', 'on-guinda')
    expect(images[0].getAttribute('src')).toContain('Logo-CMCH-fondo-guinda')
    expect(banner).toContainElement(images[0])
    expect(banner).toHaveClass('topbar')
  })

  it.each([
    ['/', USERS.multirol],
    ['/solicitante', USERS.solicitante],
    ['/administrador', USERS.administrador],
    ['/planificador', USERS.multirol],
    ['/personal-atencion', USERS.multirol],
  ])('%s: el logotipo está en el extremo izquierdo, antes del nombre SGIM-CMCH', async (route, user) => {
    backend.signIn(user)
    renderApp(route)

    const inner = (await findTopbar()).firstElementChild as HTMLElement
    const brand = screen.getByTestId('topbar-brand')
    const identity = screen.getByRole('link', { name: /SGIM-CMCH/ })

    expect(inner.firstElementChild).toBe(brand) // extremo izquierdo
    expect(inner.lastElementChild).not.toBe(brand) // nunca a la derecha
    expect(brand.compareDocumentPosition(identity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('la identidad del sistema es textual, sin isotipo propio', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/')
    const identity = await screen.findByRole('link', { name: /SGIM-CMCH/ })
    expect(identity).toHaveTextContent('SGIM-CMCH')
    expect(identity).toHaveTextContent('Sistema de Gestión de Incidencias y Mantenimiento')
    expect(within(identity).queryByRole('img')).toBeNull()
  })
})

describe('tokens y estilos de marca', () => {
  it('la cuadrícula de la barra ubica el logotipo a la izquierda en todos los tamaños', () => {
    expect(css).toMatch(/grid-template-areas:\s*'logo identity controls'/)
    expect(css).toMatch(/grid-template-areas:\s*'logo identity'\s*'controls controls'/)
    expect(css).not.toMatch(/'identity controls logo'|'identity logo'/)
  })

  it('el nombre del sistema se separa visualmente del logotipo', () => {
    expect(css).toMatch(/\.topbar__identity\s*{[^}]*border-left:/)
  })

  it('el guinda de la barra coincide con el fondo medido del logotipo PNG', () => {
    expect(css).toMatch(/--color-brand-guinda:\s*#9a1331/)
    expect(css).toMatch(/\.topbar\s*{[^}]*background:\s*var\(--color-brand-guinda\)/)
  })

  it('los logotipos conservan su proporción (object-fit: contain)', () => {
    expect(css).toMatch(/\.institution-logo\s*{[^}]*object-fit:\s*contain/)
    expect(css).toMatch(/\.institution-logo\s*{[^}]*height:\s*auto/)
  })

  it('el login tiene fondo blanco, compatible con el logotipo JPG y sin imagen de fondo', () => {
    expect(css).toMatch(/--color-brand-logo-bg:\s*#ffffff/)
    expect(css).toMatch(/\.auth-layout\s*{[^}]*background:\s*var\(--color-brand-logo-bg\)/)
    expect(css).not.toMatch(/fondo_clinica/)
  })
})
