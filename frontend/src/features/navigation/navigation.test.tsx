/**
 * Navegación unificada por capacidades (ADR 0009): menú, inicio, rutas protegidas,
 * accesibilidad y comportamiento responsive. Solo datos ficticios.
 */
import { act, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { defaultSummary, homeBackend } from '../../test/fakeHome'
import { fillLogin, renderApp } from '../../test/renderApp'
import { activeItemPath, buildMenu, canAccess, type Feature } from './access'

type User = (typeof USERS)[keyof typeof USERS]

/** Resumen por defecto que recibiría esa cuenta. */
function defaultSummaryFor(user: User) {
  backend.signIn(user)
  return defaultSummary()
}

/** Menú tal como lo ve la persona: { grupo: [opciones] }. */
function menuOf(user: User) {
  return Object.fromEntries(
    buildMenu(user).map((group) => [group.label, group.items.map((item) => item.label)]),
  )
}

async function openApp(user: User, route = '/') {
  backend.signIn(user)
  const utils = renderApp(route)
  const nav = await screen.findByRole('navigation', { name: 'Menú principal' })
  return { ...utils, nav }
}

function sidebarLinks(nav: HTMLElement) {
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent)
}

async function expectForbidden() {
  expect(
    await screen.findByRole('heading', { name: 'No tienes acceso a esta vista' }),
  ).toBeInTheDocument()
}

// --- Menú por capacidades ------------------------------------------------------------

describe('menú construido con los permisos efectivos', () => {
  it('trabajador con funciones básicas: registra y consulta sus incidencias', () => {
    expect(menuOf(USERS.solicitante)).toEqual({
      General: ['Inicio', 'Registrar incidencia', 'Mis incidencias'],
    })
  })

  it('Responsable de Área que solo planifica: Planificación, sin Verificaciones', () => {
    expect(menuOf(USERS.planificador)).toEqual({
      General: ['Inicio', 'Registrar incidencia', 'Mis incidencias'],
      Operaciones: ['Planificación'],
      Análisis: ['Indicadores', 'Reportes'],
    })
  })

  it('cuenta que solo verifica: Verificaciones, sin Planificación ni Análisis', () => {
    expect(menuOf(USERS.verificador)).toEqual({
      General: ['Inicio', 'Registrar incidencia', 'Mis incidencias'],
      Operaciones: ['Verificaciones'],
    })
  })

  it('técnico con permiso de atención: Mis atenciones', () => {
    expect(menuOf(USERS.tecnico)).toEqual({
      General: ['Inicio', 'Registrar incidencia', 'Mis incidencias'],
      Operaciones: ['Mis atenciones'],
    })
  })

  it('varias capacidades: un único menú con todo lo permitido, sin duplicados', () => {
    const menu = menuOf(USERS.multirol)
    expect(menu).toEqual({
      General: ['Inicio', 'Registrar incidencia', 'Mis incidencias'],
      Operaciones: ['Mis atenciones', 'Planificación', 'Verificaciones'],
      Análisis: ['Indicadores', 'Reportes'],
    })
    const labels = Object.values(menu).flat()
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('Administrador sin capacidades operativas: sin "Inicio"; Dashboard general es su entrada principal', () => {
    const menu = buildMenu(USERS.administrador)
    expect(menu.map((group) => group.label)).toEqual(['Administración', 'Análisis'])
    expect(menuOf(USERS.administrador)).toEqual({
      Administración: [
        'Dashboard general',
        'Consulta de incidencias',
        'Usuarios y permisos',
        'Auditoría',
      ],
      Análisis: ['Reportes'],
    })
  })

  it('cuenta administrativa y operativa: Inicio (operativo) y Dashboard general (administrativo)', () => {
    const menu = menuOf(USERS.adminOperativo)
    expect(menu.General).toEqual(['Inicio', 'Registrar incidencia', 'Mis incidencias'])
    expect(menu.Operaciones).toEqual(['Planificación'])
    expect(menu.Administración?.[0]).toBe('Dashboard general')
    const paths = buildMenu(USERS.adminOperativo).flatMap((group) => group.items.map((item) => item.path))
    expect(new Set(paths).size).toBe(paths.length) // sin enlaces duplicados
  })

  it('cuenta sin roles: solo Inicio', () => {
    expect(menuOf(USERS.sinRoles)).toEqual({ General: ['Inicio'] })
  })

  it('no depende solo del nombre del rol: el rol sin la función en un área no basta', () => {
    const roleOnly = {
      roles: ['planificador', 'personal_atencion'],
      capabilities: { can_plan: false, can_attend: false, can_verify: false },
    }
    const features: Feature[] = ['attention', 'planning', 'verifications', 'analysis', 'reports']
    expect(features.filter((feature) => canAccess(roleOnly, feature))).toEqual([])
    expect(canAccess(roleOnly, 'incidents')).toBe(true)
  })

  it('no ofrece encuestas de satisfacción todavía (sin enlaces vacíos)', () => {
    for (const user of Object.values(USERS)) {
      expect(JSON.stringify(menuOf(user))).not.toMatch(/[Ee]ncuesta/)
    }
  })

  it('marca como activa la opción más específica', () => {
    const menu = buildMenu(USERS.multirol)
    expect(activeItemPath(menu, '/incidencias/nueva')).toBe('/incidencias/nueva')
    expect(activeItemPath(menu, '/incidencias/INC-2026-0001')).toBe('/incidencias')
    expect(activeItemPath(menu, '/verificaciones/incidencias/INC-2026-0001')).toBe('/verificaciones')
    expect(activeItemPath(menu, '/')).toBe('/')
  })
})

// --- Layout -----------------------------------------------------------------------------

describe('layout unificado', () => {
  it('no hay selector de roles: el menú lateral muestra las funciones de la cuenta', async () => {
    const { nav } = await openApp(USERS.multirol)

    expect(screen.queryByRole('combobox', { name: 'Vista' })).not.toBeInTheDocument()
    expect(sidebarLinks(nav)).toEqual([
      'Inicio',
      'Registrar incidencia',
      'Mis incidencias',
      'Mis atenciones',
      'Planificación',
      'Verificaciones',
      'Indicadores',
      'Reportes',
    ])
    expect(within(nav).getByRole('heading', { name: 'Operaciones' })).toBeInTheDocument()
    expect(screen.queryByText('Planificador')).not.toBeInTheDocument()
  })

  it('marca la opción activa con aria-current', async () => {
    const { nav } = await openApp(USERS.multirol, '/incidencias/nueva')

    expect(within(nav).getByRole('link', { name: 'Registrar incidencia' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: 'Mis incidencias' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('muestra el nombre con acceso a Mi cuenta y las funciones por área, sin roles internos', async () => {
    const { user } = await openApp(USERS.multirol)

    await user.click(screen.getByRole('link', { name: 'Mi cuenta: Luis Prueba' }))

    expect(await screen.findByRole('heading', { name: 'Mi cuenta', level: 1 })).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /TI/ })
    expect(row).toHaveTextContent('Planificación · Registrar atenciones · Verificaciones')
    expect(screen.queryByText(/planificador|personal_atencion/)).not.toBeInTheDocument()
  })

  it('en escritorio el menú se puede ocultar y mostrar con el teclado', async () => {
    const { user, nav } = await openApp(USERS.solicitante)
    const toggle = screen.getByRole('button', { name: 'Ocultar menú' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'menu-principal')

    toggle.focus()
    await user.keyboard('{Enter}')

    expect(nav).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Mostrar menú' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await user.keyboard('{Enter}')
    expect(nav).toBeVisible()
  })
})

describe('menú en móviles', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubMobile() {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('max-width'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
  }

  it('está oculto; se abre con "Menú", enfoca la primera opción y se cierra con Escape', async () => {
    stubMobile()
    backend.signIn(USERS.tecnico)
    const { user } = renderApp('/')
    await screen.findByRole('heading', { name: 'Hola, Tomás' })

    const nav = document.getElementById('menu-principal') as HTMLElement
    expect(nav).toHaveAttribute('aria-label', 'Menú principal')
    expect(nav).not.toBeVisible()
    const toggle = screen.getByRole('button', { name: 'Menú' })

    await user.click(toggle)

    expect(nav).toBeVisible()
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(nav).not.toBeVisible()
    expect(toggle).toHaveFocus()
  })

  it('se cierra al elegir una opción', async () => {
    stubMobile()
    backend.signIn(USERS.tecnico)
    const { user } = renderApp('/')
    await screen.findByRole('heading', { name: 'Hola, Tomás' })

    await user.click(screen.getByRole('button', { name: 'Menú' }))
    const nav = screen.getByRole('navigation', { name: 'Menú principal' })
    await act(async () => {
      await user.click(within(nav).getByRole('link', { name: 'Mis atenciones' }))
    })

    expect(await screen.findByRole('heading', { name: 'Mis atenciones', level: 1 })).toBeInTheDocument()
    expect(nav).not.toBeVisible()
  })
})

// --- Inicio -----------------------------------------------------------------------------

describe('inicio', () => {
  /** Indicadores del Inicio: nombre accesible "Etiqueta: valor". */
  async function indicators() {
    const region = await screen.findByRole('region', { name: 'Resumen' })
    return within(region)
      .getAllByRole('link')
      .map((link) => link.getAttribute('aria-label'))
  }

  it('no repite el menú con tarjetas de acceso', async () => {
    await openApp(USERS.multirol)

    await screen.findByRole('region', { name: 'Resumen' })
    expect(screen.queryByRole('list', { name: 'Accesos directos' })).not.toBeInTheDocument()
    expect(screen.queryByText('Entrar →')).not.toBeInTheDocument()
  })

  it('trabajador con funciones básicas: solo sus incidencias, sin pendientes operativos', async () => {
    await openApp(USERS.solicitante)

    expect(await indicators()).toEqual(['Mis incidencias abiertas: 2'])
    const byStatus = screen.getByRole('list', { name: 'Mis incidencias por estado' })
    expect(byStatus).toHaveTextContent('Registrada1')
    expect(screen.queryByRole('heading', { name: 'Requiere tu atención' })).not.toBeInTheDocument()
  })

  it('solo verifica: cierres por verificar con enlace a Verificaciones, sin planificación', async () => {
    await openApp(USERS.verificador)

    expect(await indicators()).toEqual(['Cierres por verificar: 1', 'Mis incidencias abiertas: 2'])
    const table = screen.getByRole('table', { name: 'Actividades que requieren tu atención' })
    expect(within(table).getByRole('link', { name: 'Verificar INC-2026-0202' })).toHaveAttribute(
      'href',
      '/verificaciones/incidencias/INC-2026-0202',
    )
    expect(screen.queryByText(/Por programar/)).not.toBeInTheDocument()
  })

  it('solo planifica: pendientes de planificación, sin verificaciones', async () => {
    await openApp(USERS.planificador)

    expect(await indicators()).toEqual([
      'Por programar: 1',
      'Con atención pendiente: 1',
      'Mis incidencias abiertas: 2',
    ])
    const table = screen.getByRole('table', { name: 'Actividades que requieren tu atención' })
    expect(within(table).getByRole('link', { name: 'Planificar INC-2026-0203' })).toHaveAttribute(
      'href',
      '/planificacion/incidencias/INC-2026-0203',
    )
    expect(screen.queryByText('Cierres por verificar')).not.toBeInTheDocument()
  })

  it('técnico: atenciones asignadas con su fecha programada', async () => {
    await openApp(USERS.tecnico)

    expect(await indicators()).toEqual(['Atenciones asignadas: 1', 'Mis incidencias abiertas: 2'])
    const row = screen.getByRole('row', { name: /INC-2026-0201/ })
    expect(row).toHaveTextContent('Atención asignada')
    expect(row).toHaveTextContent(/Programada: 8 nov/)
    expect(within(row).getByRole('link', { name: 'Atender INC-2026-0201' })).toHaveAttribute(
      'href',
      '/atenciones/incidencias/INC-2026-0201',
    )
  })

  it('varias capacidades: todos sus indicadores y cada ticket una sola vez', async () => {
    await openApp(USERS.multirol)

    expect(await indicators()).toEqual([
      'Atenciones asignadas: 1',
      'Por programar: 1',
      'Con atención pendiente: 1',
      'Cierres por verificar: 1',
      'Mis incidencias abiertas: 2',
    ])
    const table = screen.getByRole('table', { name: 'Actividades que requieren tu atención' })
    const tickets = within(table)
      .getAllByRole('rowheader')
      .map((cell) => cell.querySelector('.data-table__code')?.textContent)
    expect(new Set(tickets).size).toBe(tickets.length)
  })

  it('informa si hay más pendientes de los que se muestran', async () => {
    const summary = defaultSummaryFor(USERS.planificador)
    homeBackend.override = { ...summary, todo: { ...summary.todo, total: 14 } }
    await openApp(USERS.planificador)

    expect(await screen.findByText(/Se muestran 2 de 14/)).toBeInTheDocument()
  })

  it('sin pendientes lo dice, sin inventar datos', async () => {
    homeBackend.override = {
      ...defaultSummaryFor(USERS.tecnico),
      attention: { assigned: 0 },
      todo: { total: 0, items: [] },
    }
    await openApp(USERS.tecnico)

    expect(await screen.findByText('No tienes actividades pendientes.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('solo muestra indicadores y pendientes: sin actividad reciente ni próximas atenciones', async () => {
    await openApp(USERS.multirol)

    await screen.findByRole('region', { name: 'Resumen' })
    const main = screen.getByRole('main')
    expect(within(main).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Resumen',
      'Requiere tu atención',
    ])
    expect(screen.queryByText(/Actividad reciente|Próximas atenciones/)).not.toBeInTheDocument()
  })

  it('ofrece un botón discreto para registrar una incidencia junto al encabezado', async () => {
    await openApp(USERS.tecnico)

    const header = (await screen.findByRole('heading', { name: 'Hola, Tomás', level: 1 })).closest('header')
    const button = within(header as HTMLElement).getByRole('link', { name: 'Registrar incidencia' })
    expect(button).toHaveAttribute('href', '/incidencias/nueva')
    expect(button).toHaveClass('btn--secondary')
  })

  it('sin autorización para registrar no se ofrece el botón', async () => {
    await openApp(USERS.sinRoles)

    await screen.findByText('Tu cuenta todavía no tiene funciones asignadas')
    expect(screen.queryByRole('link', { name: 'Registrar incidencia' })).not.toBeInTheDocument()
  })

  it('encuestas pendientes: indicador que lleva a Mis incidencias', async () => {
    homeBackend.override = { ...defaultSummaryFor(USERS.solicitante), surveys: { pending: 2 } }
    await openApp(USERS.solicitante)

    expect(await indicators()).toEqual(['Encuestas pendientes: 2', 'Mis incidencias abiertas: 2'])
    expect(screen.getByRole('link', { name: 'Encuestas pendientes: 2' })).toHaveAttribute('href', '/incidencias')
  })

  it('sin encuestas pendientes no muestra el indicador', async () => {
    homeBackend.override = { ...defaultSummaryFor(USERS.solicitante), surveys: { pending: 0 } }
    await openApp(USERS.solicitante)

    expect(await indicators()).toEqual(['Mis incidencias abiertas: 2'])
  })

  it('cuenta exclusivamente administrativa: al iniciar sesión entra al Dashboard general', async () => {
    const { user } = renderApp('/login')

    await fillLogin(user, 'admin.prueba')

    expect(
      await screen.findByRole('heading', { name: 'Panel de Administración', level: 1 }),
    ).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Menú principal' })
    expect(within(nav).queryByRole('link', { name: 'Inicio' })).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Dashboard general' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'SGIM-CMCH, ir al inicio' })).toHaveAttribute('href', '/administracion')
    expect(homeBackend.calls).toBe(0)
  })

  it('cuenta administrativa y operativa: Inicio y Dashboard general no repiten contenido', async () => {
    const { user, nav } = await openApp(USERS.adminOperativo)

    // Inicio: dashboard operativo personal.
    expect(await screen.findByRole('region', { name: 'Resumen' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Panel de Administración' })).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'SGIM-CMCH, ir al inicio' })).toHaveAttribute('href', '/')

    // Dashboard general: panel administrativo, sin el resumen operativo.
    await user.click(within(nav).getByRole('link', { name: 'Dashboard general' }))
    expect(
      await screen.findByRole('heading', { name: 'Panel de Administración', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Resumen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Requiere tu atención' })).not.toBeInTheDocument()
  })

  it('trabajador operativo: conserva Inicio con su resumen y no ve el Dashboard general', async () => {
    const { nav } = await openApp(USERS.multirol)

    expect(await screen.findByRole('region', { name: 'Resumen' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Inicio' })).toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Dashboard general' })).not.toBeInTheDocument()
  })

  it('cuenta exclusivamente administrativa: va al Panel de Administración', async () => {
    await openApp(USERS.administrador)
    expect(homeBackend.calls).toBe(0)

    expect(
      await screen.findByRole('heading', { name: 'Panel de Administración', level: 1 }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Por estado' })).toBeInTheDocument()
  })

  it('cuenta sin funciones: indicación clara', async () => {
    await openApp(USERS.sinRoles)

    expect(
      await screen.findByText('Tu cuenta todavía no tiene funciones asignadas'),
    ).toBeInTheDocument()
  })
})

// --- Rutas no autorizadas -----------------------------------------------------------------

describe('rutas protegidas', () => {
  it.each([
    ['solicitante', USERS.solicitante, ['/planificacion', '/verificaciones', '/atenciones', '/indicadores', '/reportes', '/administracion']],
    ['planificador', USERS.planificador, ['/verificaciones', '/atenciones', '/administracion/usuarios']],
    ['verificador', USERS.verificador, ['/planificacion', '/planificacion/incidencias/INC-2026-0001', '/indicadores', '/reportes']],
    ['técnico', USERS.tecnico, ['/planificacion', '/verificaciones', '/administracion/auditoria']],
    ['administrador', USERS.administrador, ['/incidencias/nueva', '/incidencias', '/planificacion', '/verificaciones', '/atenciones', '/indicadores']],
  ])('%s no accede a lo que no le corresponde', async (_label, account, routes) => {
    for (const route of routes) {
      backend.signIn(account)
      const { unmount } = renderApp(route)
      await expectForbidden()
      unmount()
    }
  })

  it('las rutas anteriores por rol redirigen a las actuales, sin ampliar permisos', async () => {
    backend.signIn(USERS.solicitante)
    const first = renderApp('/solicitante/incidencias/nueva')
    expect(await screen.findByRole('heading', { name: 'Registrar incidencia', level: 1 })).toBeInTheDocument()
    first.unmount()

    backend.signIn(USERS.solicitante)
    renderApp('/planificador')
    await expectForbidden()
  })

  it('una ruta desconocida muestra "Página no encontrada"', async () => {
    await openApp(USERS.solicitante, '/no-existe')

    expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeInTheDocument()
  })
})
