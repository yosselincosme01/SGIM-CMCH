import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { adminBackend } from '../../test/fakeAdmin'
import { backend, USERS } from '../../test/fakeBackend'
import { renderApp } from '../../test/renderApp'

function signIn(user: (typeof USERS)[keyof typeof USERS]) {
  backend.signIn(user)
  document.cookie = `csrftoken=${backend.csrfToken}; path=/`
}

const writes = () => adminBackend.requests.filter((r) => r.method !== 'GET')

describe('acceso a la administración', () => {
  it('sin el rol Administrador no se muestra la vista', async () => {
    signIn(USERS.multirol)
    renderApp('/administracion/usuarios')

    expect(await screen.findByRole('heading', { name: 'No tienes acceso a esta vista' })).toBeInTheDocument()
  })
})

describe('gestión de usuarios', () => {
  it('muestra roles con su nombre visible, permisos por área y estado de la cuenta', async () => {
    signIn(USERS.administrador)
    renderApp('/administracion/usuarios')

    const row = await screen.findByRole('row', { name: /tec\.uno/ })
    expect(within(row).getByText('Personal de Atención')).toBeInTheDocument()
    expect(row).toHaveTextContent('TI: Registrar atenciones')
    expect(within(row).getByText('Activa')).toBeInTheDocument()
    expect(screen.getByText('3 cuentas')).toBeInTheDocument()
    const roleFilter = screen.getByLabelText('Rol interno')
    expect(within(roleFilter).getByRole('option', { name: 'Responsable de Área' })).toBeInTheDocument()
    expect(screen.queryByText('Planificador')).not.toBeInTheDocument()
  })

  it('lista, busca y marca las cuentas protegidas', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/usuarios')

    const table = await screen.findByRole('table')
    expect(within(table).getByText('admin.prueba')).toBeInTheDocument()
    expect(within(table).getByText('Cuenta protegida')).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Ver admin.prueba' })).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Editar tec.uno' })).toBeInTheDocument()

    await user.type(screen.getByLabelText(/Buscar por usuario/), 'sol')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))

    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('tec.uno')).not.toBeInTheDocument())
    expect(adminBackend.requests.at(-1)?.path).toContain('q=sol')
  })

  it('crea una cuenta con roles y autorizaciones por área, sin campos de privilegio', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/usuarios/nuevo')
    await screen.findByRole('heading', { name: 'Nuevo usuario', level: 1 })

    const planTi = screen.getByRole('checkbox', { name: 'Planificar atenciones en TI' })
    expect(planTi).toBeDisabled() // requiere el rol Planificador
    expect(screen.getByRole('checkbox', { name: 'Verificar conformidad en TI' })).toBeDisabled()
    expect(screen.queryByRole('checkbox', { name: /Administrador/ })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Nombre de usuario/), 'nueva.prueba')
    await user.type(screen.getByLabelText(/^Nombres/), 'Nueva')
    await user.type(screen.getByLabelText(/^Apellidos/), 'Prueba')
    await user.type(screen.getByLabelText(/^Contraseña/), 'Clave-Ficticia-2027')
    await user.type(screen.getByLabelText(/Repite la contraseña/), 'Clave-Ficticia-2027')
    await user.click(screen.getByRole('checkbox', { name: 'Responsable de Área' }))
    await user.click(screen.getByRole('checkbox', { name: 'Planificar atenciones en TI' }))
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))

    expect(await screen.findByRole('heading', { name: 'Nueva Prueba', level: 1 })).toBeInTheDocument()
    const [request] = writes()
    expect(request.csrfHeader).toBe(backend.csrfToken)
    expect(request.body).toEqual({
      username: 'nueva.prueba',
      first_name: 'Nueva',
      last_name: 'Prueba',
      email: '',
      password: 'Clave-Ficticia-2027',
      password_confirm: 'Clave-Ficticia-2027',
      roles: ['planificador'],
      memberships: [{ area: 'ti', can_plan: true, can_be_assigned: false, can_verify: false }],
    })
  })

  it('permite verificar conformidad sin el rol Planificador', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/usuarios/nuevo')
    await screen.findByRole('heading', { name: 'Nuevo usuario', level: 1 })
    const verifyTi = screen.getByRole('checkbox', { name: 'Verificar conformidad en TI' })
    expect(verifyTi).toBeDisabled() // sin ningún rol operativo

    await user.click(screen.getByRole('checkbox', { name: 'Solicitante' }))
    expect(verifyTi).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'Planificar atenciones en TI' })).toBeDisabled()
    await user.click(verifyTi)
    await user.type(screen.getByLabelText(/Nombre de usuario/), 'vera.prueba')
    await user.type(screen.getByLabelText(/^Nombres/), 'Vera')
    await user.type(screen.getByLabelText(/^Apellidos/), 'Prueba')
    await user.type(screen.getByLabelText(/^Contraseña/), 'Clave-Ficticia-2027')
    await user.type(screen.getByLabelText(/Repite la contraseña/), 'Clave-Ficticia-2027')
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))

    await screen.findByRole('heading', { name: 'Vera Prueba', level: 1 })
    expect(writes()[0].body).toMatchObject({
      roles: ['solicitante'],
      memberships: [{ area: 'ti', can_plan: false, can_be_assigned: false, can_verify: true }],
    })
  })

  it('configura planificar, registrar atenciones y verificar conformidad por separado', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/usuarios/nuevo')
    await screen.findByRole('heading', { name: 'Nuevo usuario', level: 1 })

    await user.type(screen.getByLabelText(/Nombre de usuario/), 'verif.prueba')
    await user.type(screen.getByLabelText(/^Nombres/), 'Vera')
    await user.type(screen.getByLabelText(/^Apellidos/), 'Prueba')
    await user.type(screen.getByLabelText(/^Contraseña/), 'Clave-Ficticia-2027')
    await user.type(screen.getByLabelText(/Repite la contraseña/), 'Clave-Ficticia-2027')
    await user.click(screen.getByRole('checkbox', { name: 'Responsable de Área' }))
    await user.click(screen.getByRole('checkbox', { name: 'Personal de Atención' }))
    // Verifica en TI sin planificar; planifica en Mantenimiento sin verificar.
    await user.click(screen.getByRole('checkbox', { name: 'Verificar conformidad en TI' }))
    await user.click(screen.getByRole('checkbox', { name: 'Planificar atenciones en Mantenimiento' }))
    await user.click(screen.getByRole('checkbox', { name: 'Registrar atenciones en Ingeniería Clínica' }))
    expect(screen.getByRole('checkbox', { name: 'Planificar atenciones en TI' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Verificar conformidad en Mantenimiento' })).not.toBeChecked()

    // Al retirar el rol Planificador se desmarca planificar, pero verificar se conserva
    // porque queda otro rol operativo.
    await user.click(screen.getByRole('checkbox', { name: 'Responsable de Área' }))
    expect(screen.getByRole('checkbox', { name: 'Verificar conformidad en TI' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Planificar atenciones en Mantenimiento' })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Responsable de Área' }))
    await user.click(screen.getByRole('checkbox', { name: 'Planificar atenciones en Mantenimiento' }))
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))

    await screen.findByRole('heading', { name: 'Vera Prueba', level: 1 })
    const memberships = (writes()[0].body as { memberships: unknown[] }).memberships
    expect(memberships).toEqual(
      expect.arrayContaining([
        { area: 'ti', can_plan: false, can_be_assigned: false, can_verify: true },
        { area: 'mantenimiento', can_plan: true, can_be_assigned: false, can_verify: false },
        { area: 'ingenieria_clinica', can_plan: false, can_be_assigned: true, can_verify: false },
      ]),
    )
    expect(memberships).toHaveLength(3)
  })

  it('valida en el navegador y muestra los errores del servidor', async () => {
    signIn(USERS.administrador)
    adminBackend.nextError = { status: 400, body: { password: ['La contraseña es demasiado común.'] } }
    const { user } = renderApp('/administracion/usuarios/nuevo')
    await screen.findByRole('heading', { name: 'Nuevo usuario', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))
    expect(screen.getByText('Indica el nombre de usuario.')).toBeInTheDocument()
    expect(writes()).toHaveLength(0)

    await user.type(screen.getByLabelText(/Nombre de usuario/), 'x.prueba')
    await user.type(screen.getByLabelText(/^Nombres/), 'X')
    await user.type(screen.getByLabelText(/^Apellidos/), 'Prueba')
    await user.type(screen.getByLabelText(/^Contraseña/), 'password123')
    await user.type(screen.getByLabelText(/Repite la contraseña/), 'password123')
    await user.click(screen.getByRole('button', { name: 'Crear usuario' }))

    expect(await screen.findByText('La contraseña es demasiado común.')).toBeInTheDocument()
  })

  it('una cuenta protegida se muestra solo para consulta', async () => {
    signIn(USERS.administrador)
    renderApp('/administracion/usuarios/3')

    expect(await screen.findByText(/solo se gestionan mediante el procedimiento técnico de TI/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Desactivar cuenta/ })).not.toBeInTheDocument()
  })

  it('confirma la desactivación e informa si hay asignaciones vigentes', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/usuarios/10')
    await screen.findByRole('heading', { name: 'Tec Prueba', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Desactivar cuenta' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Desactivar la cuenta?' })
    expect(writes()).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText(/tiene asignaciones vigentes/)).toBeInTheDocument()
  })

  it('restablece la contraseña tras confirmar, sin mostrarla', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/usuarios/11')
    await screen.findByRole('heading', { name: 'Sol Prueba', level: 1 })

    await user.type(screen.getByLabelText('Nueva contraseña'), 'Nueva-Clave-2027')
    await user.type(screen.getByLabelText('Repite la nueva contraseña'), 'Nueva-Clave-2027')
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText(/Contraseña restablecida/)).toBeInTheDocument()
    expect(screen.queryByText('Nueva-Clave-2027')).not.toBeInTheDocument()
    expect(writes().at(-1)?.body).toEqual({
      password: 'Nueva-Clave-2027',
      password_confirm: 'Nueva-Clave-2027',
    })
  })
})

describe('indicadores y reportes', () => {
  it('el Panel de Administración muestra indicadores reales, sin SLA ni acciones', async () => {
    signIn(USERS.administrador)
    renderApp('/administracion')

    expect(await screen.findByRole('heading', { name: 'Panel de Administración', level: 1 })).toBeInTheDocument()
    const kpis = await screen.findByRole('region', { name: 'Indicadores del periodo' })
    const values = within(kpis)
      .getAllByRole('listitem')
      .map((item) => [item.querySelector('.kpi__label')?.textContent, item.querySelector('.kpi__value')?.textContent])
    expect(values).toEqual([
      ['Registradas', '4'],
      ['Abiertas', '3'],
      ['En proceso', '1'],
      ['Cerradas técnicamente', '1'],
      ['Pendientes de verificación', '0'],
    ])
    expect(screen.queryByText(/SLA|plazo/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Planificar|Atender|Verificar|Reabrir/ })).not.toBeInTheDocument()
  })

  it('muestra todos los estados y las tres áreas, incluidos los ceros', async () => {
    signIn(USERS.administrador)
    renderApp('/administracion')

    const byStatus = await screen.findByRole('region', { name: 'Por estado' })
    expect(within(byStatus).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Registrada0 (0 %)',
      'Asignada1 (25 %)',
      'Cerrada0 (0 %)',
      'Reabierta0 (0 %)',
    ])
    const byArea = screen.getByRole('region', { name: 'Por área de soporte' })
    expect(within(byArea).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Ingeniería Clínica0 (0 %)',
      'Mantenimiento0 (0 %)',
      'TI3 (75 %)',
    ])
  })

  it('lista las incidencias recientes con acceso al detalle de solo lectura', async () => {
    signIn(USERS.administrador)
    renderApp('/administracion')

    const recent = await screen.findByRole('region', { name: 'Incidencias recientes' })
    expect(within(recent).getByRole('link', { name: 'INC-2026-0101' })).toHaveAttribute(
      'href',
      '/administracion/incidencias/INC-2026-0101',
    )
    expect(within(recent).getAllByRole('row')).toHaveLength(3)
  })

  it('filtra el panel por área y periodo en ambos endpoints', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion')
    await screen.findByRole('region', { name: 'Por estado' })

    await user.selectOptions(screen.getByLabelText('Área de soporte'), 'ti')
    fireEvent.change(screen.getByLabelText('Registradas desde'), { target: { value: '2026-11-01' } })
    await user.click(screen.getByRole('button', { name: 'Aplicar' }))

    await waitFor(() => {
      const paths = adminBackend.requests.map((r) => r.path)
      expect(paths.some((path) => path.startsWith('/api/v1/reports/dashboard/') && path.includes('area=ti') && path.includes('date_from=2026-11-01'))).toBe(true)
      expect(paths.some((path) => path.startsWith('/api/v1/admin/incidents/') && path.includes('area=ti') && path.includes('date_from=2026-11-01'))).toBe(true)
    })
    const byArea = await screen.findByRole('region', { name: 'Por área de soporte' })
    expect(within(byArea).getAllByRole('listitem')).toHaveLength(1)
  })

  it('el Responsable de Área ve solo sus áreas autorizadas', async () => {
    signIn(USERS.multirol)
    renderApp('/indicadores')

    expect(await screen.findByText('Tus áreas autorizadas', { selector: 'strong' })).toBeInTheDocument()
    const areas = within(screen.getByLabelText('Área')).getAllByRole('option').map((o) => o.textContent)
    expect(areas).toEqual(['Tus áreas autorizadas', 'TI'])
  })

  it('descarga un reporte .xlsx con los filtros aplicados', async () => {
    signIn(USERS.administrador)
    const realFetch = globalThis.fetch
    let exportUrl = ''
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/export/')) {
        exportUrl = url
        return new Response(new Blob(['xlsx']), {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="sgim-incidents-20261009-20261107.xlsx"' },
        })
      }
      return realFetch(input, init)
    })
    const createUrl = vi.fn(() => 'blob:prueba')
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { user } = renderApp('/reportes')

    await user.click(await screen.findByRole('button', { name: 'Descargar Incidencias generales en Excel' }))

    expect(await screen.findByText(/Se descargó «Incidencias generales»/)).toBeInTheDocument()
    expect(exportUrl).toContain('/api/v1/reports/incidents/export/?date_from=')
    expect(click).toHaveBeenCalled()
    expect(createUrl).toHaveBeenCalled()
  })

  it('informa el límite de descarga', async () => {
    signIn(USERS.administrador)
    const realFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/export/')) {
        return new Response(JSON.stringify({ detail: 'El reporte supera 5000 filas.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return realFetch(input, init)
    })
    const { user } = renderApp('/reportes')

    await user.click(await screen.findByRole('button', { name: 'Descargar Pendientes en Excel' }))

    expect(await screen.findByText(/supera 5000 filas/)).toBeInTheDocument()
  })
})

describe('consulta global de incidencias (solo lectura)', () => {
  it('filtra por periodo y permite limpiar los filtros', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/incidencias?desde=2026-11-01&hasta=2026-11-07')

    await screen.findByRole('table')
    expect(screen.getByLabelText('Registradas desde')).toHaveValue('2026-11-01')
    expect(adminBackend.requests.at(-1)?.path).toContain('date_from=2026-11-01')
    expect(adminBackend.requests.at(-1)?.path).toContain('date_to=2026-11-07')

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))

    await waitFor(() => expect(adminBackend.requests.at(-1)?.path).toBe('/api/v1/admin/incidents/'))
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument()
  })

  it('lista las incidencias de todas las áreas y filtra por área', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/incidencias')

    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(2)
    expect(within(table).getByText('Pendiente de verificación')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Área de soporte'), 'mantenimiento')

    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2))
    expect(adminBackend.requests.at(-1)?.path).toContain('area=mantenimiento')
  })

  it('el detalle no muestra evidencias ni acciones operativas', async () => {
    signIn(USERS.administrador)
    renderApp('/administracion/incidencias/INC-2026-0101')

    expect(await screen.findByRole('heading', { name: 'INC-2026-0101', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/Modo lectura/)).toHaveTextContent('El registro tiene 1 fotografía.')
    expect(screen.getByText('Cable de red dañado (ficticio).')).toBeInTheDocument()
    expect(screen.getByText(/2 fotografías de evidencia \(no disponibles/)).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Evidencia/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Registrar verificación|Programar|Reabrir/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Programar atención|Cierre técnico/ })).not.toBeInTheDocument()
  })

  it('un trabajador no accede a la consulta global', async () => {
    signIn(USERS.multirol)
    renderApp('/administracion/incidencias')

    expect(await screen.findByRole('heading', { name: 'No tienes acceso a esta vista' })).toBeInTheDocument()
    expect(adminBackend.requests.some((r) => r.path.startsWith('/api/v1/admin/incidents'))).toBe(false)
  })
})

describe('auditoría', () => {
  it('muestra las operaciones registradas y filtra por operación', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administracion/auditoria')

    const table = await screen.findByRole('table')
    expect(within(table).getByText('Reporte exportado')).toBeInTheDocument()
    expect(within(table).getByText('tec.uno')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Operación'), 'user_created')

    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Reporte exportado')).not.toBeInTheDocument())
    expect(adminBackend.requests.at(-1)?.path).toContain('action=user_created')
  })
})

describe('reportes', () => {
  it('el Responsable de Área descarga reportes de sus áreas desde Análisis', async () => {
    signIn(USERS.planificador)
    renderApp('/reportes')

    expect(await screen.findByRole('heading', { name: 'Reportes', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText('Tus áreas autorizadas', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descargar Incidencias generales en Excel' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Incidencias (por ticket)' })).not.toBeInTheDocument()
  })
})
