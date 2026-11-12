/**
 * Navegación unificada por capacidades (ADR 0009): menú, inicio, rutas protegidas,
 * accesibilidad y comportamiento responsive. Solo datos ficticios.
 */
import { act, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { defaultSummary, homeBackend } from '../../test/fakeHome'
import { incidentsBackend } from '../../test/fakeIncidents'
import { surveyBackend } from '../../test/fakeSurvey'
import { fillLogin, renderApp } from '../../test/renderApp'
import { formatRelativeDay } from '../../shared/dates'
import { groupOwnStatuses } from '../workspace/ownStatusGroups'
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

  it('«Ver perfil» lleva a Mi cuenta con los datos personales, sin roles ni permisos', async () => {
    const { user } = await openApp(USERS.multirol)

    await user.click(screen.getByRole('button', { name: 'Menú de perfil de Luis Prueba' }))
    await user.click(screen.getByRole('link', { name: 'Ver perfil' }))

    expect(await screen.findByRole('heading', { name: 'Mi cuenta', level: 1 })).toBeInTheDocument()
    const card = screen.getByRole('region', { name: 'Datos personales' })
    const data = within(card)
      .getAllByRole('term')
      .map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`)
    expect(data).toEqual([
      'Nombre: Luis Prueba',
      `Usuario: ${USERS.multirol.username}`,
      `Correo electrónico: ${USERS.multirol.username}@example.test`,
    ])
    expect(card).toHaveTextContent('Si necesitas actualizar tus datos, contacta al administrador del sistema.')
    // Ni roles internos ni funciones por área o capacidades técnicas.
    expect(screen.queryByText(/planificador|personal_atencion|administrador$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Funciones|Planificación ·|Verificaciones ·|can_/)).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('Mi cuenta sin correo registrado no muestra ese dato', async () => {
    const { user } = await openApp({ ...USERS.solicitante, email: '' })

    await user.click(screen.getByRole('button', { name: /Menú de perfil/ }))
    await user.click(screen.getByRole('link', { name: 'Ver perfil' }))

    const card = await screen.findByRole('region', { name: 'Datos personales' })
    expect(within(card).getAllByRole('term').map((term) => term.textContent)).toEqual(['Nombre', 'Usuario'])
  })

  it('en escritorio el menú lateral está siempre visible y no hay botón para ocultarlo', async () => {
    const { user, nav } = await openApp(USERS.solicitante)

    expect(nav).toBeVisible()
    expect(screen.queryByRole('button', { name: /menú$/i })).not.toBeInTheDocument()
    await user.click(within(nav).getByRole('link', { name: 'Mis incidencias' }))
    await screen.findByRole('heading', { name: 'Mis incidencias', level: 1 })
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
    const toggle = screen.getByRole('button', { name: 'Abrir menú' })

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

    await user.click(screen.getByRole('button', { name: 'Abrir menú' }))
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
  /** Tarjetas del resumen: «valor etiqueta». */
  async function summaryCards() {
    const list = await screen.findByRole('list', { name: 'Mis incidencias por estado' })
    return within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
  }

  /** Conteos del trabajo de las áreas: nombre accesible «Etiqueta: valor». */
  function workChips() {
    const list = screen.queryByRole('list', { name: 'Trabajo de tus áreas' })
    return list
      ? within(list)
          .getAllByRole('link')
          .map((link) => link.getAttribute('aria-label'))
      : []
  }

  function signInWithReminderShown(user: User) {
    backend.signIn(user)
    surveyBackend.reminderShownIn.push(backend.sessionId) // el recordatorio ya se vio
  }

  it('no repite el menú con tarjetas de acceso', async () => {
    await openApp(USERS.multirol)

    await summaryCards()
    expect(screen.queryByRole('list', { name: 'Accesos directos' })).not.toBeInTheDocument()
    expect(screen.queryByText('Entrar →')).not.toBeInTheDocument()
  })

  it('resumen de mis incidencias en tres grupos sin duplicados', async () => {
    homeBackend.override = {
      ...defaultSummaryFor(USERS.solicitante),
      own: {
        total: 6,
        by_status: [
          { key: 'registrada', label: 'Registrada', total: 1 },
          { key: 'asignada', label: 'Asignada', total: 2 },
          { key: 'cerrada', label: 'Cerrada', total: 1 },
          { key: 'reabierta', label: 'Reabierta', total: 2 },
        ],
      },
    }
    await openApp(USERS.solicitante)

    // Pendientes = registradas + reabiertas; En atención = asignadas; Cerradas = cerradas.
    expect(await summaryCards()).toEqual(['3Pendientes', '2En atención', '1Cerradas'])
  })

  it('agrupa los estados reales sin contar dos veces', () => {
    const own = {
      total: 4,
      by_status: [
        { key: 'registrada', label: 'Registrada', total: 1 },
        { key: 'asignada', label: 'Asignada', total: 1 },
        { key: 'cerrada', label: 'Cerrada', total: 1 },
        { key: 'reabierta', label: 'Reabierta', total: 1 },
      ],
    }
    const groups = groupOwnStatuses(own)
    expect(groups).toEqual({ pending: 2, inAttention: 1, closed: 1 })
    expect(groups.pending + groups.inAttention + groups.closed).toBe(own.total)
  })

  it('trabajador con funciones básicas: su resumen, sin pendientes operativos', async () => {
    await openApp(USERS.solicitante)

    expect(await summaryCards()).toEqual(['1Pendientes', '1En atención', '1Cerradas'])
    expect(screen.queryByRole('heading', { name: 'Requiere tu atención' })).not.toBeInTheDocument()
    expect(workChips()).toEqual([])
  })

  it('solo verifica: cierres por verificar con enlace a Verificaciones, sin planificación', async () => {
    await openApp(USERS.verificador)

    await summaryCards()
    expect(workChips()).toEqual(['Cierres por verificar: 1'])
    const list = screen.getByRole('list', { name: 'Actividades que requieren tu atención' })
    expect(within(list).getByRole('link', { name: 'Verificar INC-2026-0202' })).toHaveAttribute(
      'href',
      '/verificaciones/incidencias/INC-2026-0202',
    )
    expect(screen.queryByText(/Por programar/)).not.toBeInTheDocument()
  })

  it('solo planifica: pendientes de planificación, sin verificaciones', async () => {
    await openApp(USERS.planificador)

    await summaryCards()
    expect(workChips()).toEqual(['Por programar: 1', 'Con atención pendiente: 1'])
    const list = screen.getByRole('list', { name: 'Actividades que requieren tu atención' })
    expect(within(list).getByRole('link', { name: 'Planificar INC-2026-0203' })).toHaveAttribute(
      'href',
      '/planificacion/incidencias/INC-2026-0203',
    )
    expect(screen.queryByText('Cierres por verificar')).not.toBeInTheDocument()
  })

  it('técnico: atenciones asignadas con su fecha programada', async () => {
    await openApp(USERS.tecnico)

    await summaryCards()
    expect(workChips()).toEqual(['Atenciones asignadas: 1'])
    const item = screen.getByRole('link', { name: 'Atender INC-2026-0201' })
    expect(item).toHaveTextContent('Atención asignada')
    expect(item).toHaveTextContent(/Programada: (Hoy|Ayer|.*nov)/)
    expect(item).toHaveAttribute('href', '/atenciones/incidencias/INC-2026-0201')
  })

  it('varias capacidades: todos sus conteos y cada ticket una sola vez', async () => {
    await openApp(USERS.multirol)

    await summaryCards()
    expect(workChips()).toEqual([
      'Atenciones asignadas: 1',
      'Por programar: 1',
      'Con atención pendiente: 1',
      'Cierres por verificar: 1',
    ])
    const list = screen.getByRole('list', { name: 'Actividades que requieren tu atención' })
    const tickets = [...list.querySelectorAll('.home-item__code')].map((node) => node.textContent)
    expect(new Set(tickets).size).toBe(tickets.length)
  })

  it('informa si hay más pendientes de los que se muestran', async () => {
    const summary = defaultSummaryFor(USERS.planificador)
    homeBackend.override = { ...summary, todo: { ...summary.todo, total: 14 } }
    await openApp(USERS.planificador)

    expect(await screen.findByText(/Se muestran 2 de 14/)).toBeInTheDocument()
  })

  it('sin pendientes operativos lo dice, sin inventar datos', async () => {
    homeBackend.override = {
      ...defaultSummaryFor(USERS.tecnico),
      attention: { assigned: 0 },
      todo: { total: 0, items: [] },
    }
    await openApp(USERS.tecnico)

    expect(await screen.findByText('No tienes actividades pendientes.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Actividades que requieren tu atención' })).not.toBeInTheDocument()
  })

  it('ordena las secciones: resumen, trabajo y mis incidencias recientes', async () => {
    await openApp(USERS.multirol)

    await summaryCards()
    const main = screen.getByRole('main')
    expect(within(main).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Resumen',
      'Requiere tu atención',
      'Mis incidencias recientes',
    ])
    expect(screen.queryByText(/Actividad reciente|Próximas atenciones/)).not.toBeInTheDocument()
  })

  it('la acción principal «Registrar incidencia» está junto al saludo y lleva al formulario', async () => {
    await openApp(USERS.tecnico)

    const header = (await screen.findByRole('heading', { name: 'Hola, Tomás', level: 1 })).closest('header')
    const button = within(header as HTMLElement).getByRole('link', { name: 'Registrar incidencia' })
    expect(button).toHaveAttribute('href', '/incidencias/nueva')
    expect(button).toHaveClass('home__cta')
    expect(screen.getByText('¿En qué podemos ayudarte hoy?')).toBeInTheDocument()
  })

  it('sin autorización para registrar no se ofrece el botón', async () => {
    await openApp(USERS.sinRoles)

    await screen.findByText('Tu cuenta todavía no tiene funciones asignadas')
    expect(screen.queryByRole('link', { name: 'Registrar incidencia' })).not.toBeInTheDocument()
  })

  it('encuesta pendiente: tarjeta con «Evaluar atención» hacia la encuesta existente', async () => {
    const incident = incidentsBackend.seed(USERS.solicitante.username, {
      status: 'cerrada',
      status_label: 'Cerrada',
    })
    surveyBackend.pending(incident.code)
    homeBackend.override = { ...defaultSummaryFor(USERS.solicitante), surveys: { pending: 1 } }
    signInWithReminderShown(USERS.solicitante)
    renderApp('/')

    const card = await screen.findByRole('region', { name: 'Tienes 1 encuesta pendiente' })
    expect(card).toHaveTextContent('Evalúa la atención de una incidencia cerrada.')
    await waitFor(() =>
      expect(within(card).getByRole('link', { name: 'Evaluar atención' })).toHaveAttribute(
        'href',
        `/incidencias/${incident.code}?evaluar=1`,
      ),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument() // el recordatorio no se duplica
  })

  it('varias encuestas pendientes: un solo aviso, empezando por la más reciente', async () => {
    homeBackend.override = { ...defaultSummaryFor(USERS.solicitante), surveys: { pending: 3 } }
    signInWithReminderShown(USERS.solicitante)
    renderApp('/')

    const card = await screen.findByRole('region', { name: 'Tienes 3 encuestas pendientes' })
    expect(within(card).getAllByRole('link')).toHaveLength(1)
  })

  it('sin encuestas pendientes no muestra la tarjeta', async () => {
    homeBackend.override = { ...defaultSummaryFor(USERS.solicitante), surveys: { pending: 0 } }
    await openApp(USERS.solicitante)

    await summaryCards()
    expect(screen.queryByRole('region', { name: /encuesta/i })).not.toBeInTheDocument()
  })

  it('sin incidencias propias: estado vacío claro y sin «Ver todas»', async () => {
    await openApp(USERS.solicitante)

    const section = await screen.findByRole('region', { name: 'Mis incidencias recientes' })
    expect(section).toHaveTextContent('Aún no has registrado incidencias.')
    expect(within(section).queryByRole('link', { name: 'Ver todas' })).not.toBeInTheDocument()
  })

  it('una incidencia reciente: código, descripción, área, fecha y estado, con acceso al detalle', async () => {
    const incident = incidentsBackend.seed(USERS.solicitante.username, {
      description: 'Monitor de signos vitales no enciende (ficticio).',
      status: 'asignada',
      status_label: 'Asignada',
    })
    await openApp(USERS.solicitante)

    const section = await screen.findByRole('region', { name: 'Mis incidencias recientes' })
    const item = await within(section).findByRole('link', { name: new RegExp(incident.code) })
    expect(item).toHaveAttribute('href', `/incidencias/${incident.code}`)
    expect(item).toHaveTextContent('Monitor de signos vitales no enciende (ficticio).')
    expect(item).toHaveTextContent(incident.support_area.name)
    expect(item).toHaveTextContent('Asignada')
    expect(within(section).getByRole('link', { name: 'Ver todas' })).toHaveAttribute('href', '/incidencias')
  })

  it('varias incidencias: muestra como máximo cinco, las más recientes', async () => {
    const seeded = Array.from({ length: 7 }, (_, index) =>
      incidentsBackend.seed(USERS.solicitante.username, { description: `Incidencia ficticia ${index}.` }),
    )
    await openApp(USERS.solicitante)

    const list = await screen.findByRole('list', { name: 'Mis incidencias recientes' })
    const codes = [...list.querySelectorAll('.home-item__code')].map((node) => node.textContent)
    expect(codes).toEqual(seeded.slice(2).reverse().map((incident) => incident.code))
  })

  it('fechas breves en hora de Lima: hoy, ayer o la fecha completa', () => {
    const now = new Date('2026-11-10T20:00:00Z') // 15:00 en Lima
    expect(formatRelativeDay('2026-11-10T14:42:00Z', now)).toMatch(/^Hoy, 9:42\sa/)
    expect(formatRelativeDay('2026-11-09T21:18:00Z', now)).toMatch(/^Ayer, 4:18\sp/)
    expect(formatRelativeDay('2026-11-05T15:00:00Z', now)).toMatch(/nov/)
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
