import { screen, waitFor, within } from '@testing-library/react'
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
    renderApp('/administrador/usuarios')

    expect(await screen.findByRole('heading', { name: 'No tienes acceso a esta vista' })).toBeInTheDocument()
  })
})

describe('gestión de usuarios', () => {
  it('lista, busca y marca las cuentas protegidas', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administrador/usuarios')

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
    const { user } = renderApp('/administrador/usuarios/nuevo')
    await screen.findByRole('heading', { name: 'Nuevo usuario', level: 1 })

    const planTi = screen.getByRole('checkbox', { name: 'Planificar en TI' })
    expect(planTi).toBeDisabled() // requiere el rol Planificador
    expect(screen.queryByRole('checkbox', { name: /Administrador/ })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Nombre de usuario/), 'nueva.prueba')
    await user.type(screen.getByLabelText(/^Nombres/), 'Nueva')
    await user.type(screen.getByLabelText(/^Apellidos/), 'Prueba')
    await user.type(screen.getByLabelText(/^Contraseña/), 'Clave-Ficticia-2027')
    await user.type(screen.getByLabelText(/Repite la contraseña/), 'Clave-Ficticia-2027')
    await user.click(screen.getByRole('checkbox', { name: 'Planificador' }))
    await user.click(screen.getByRole('checkbox', { name: 'Planificar en TI' }))
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
      memberships: [{ area: 'ti', can_plan: true, can_be_assigned: false }],
    })
  })

  it('valida en el navegador y muestra los errores del servidor', async () => {
    signIn(USERS.administrador)
    adminBackend.nextError = { status: 400, body: { password: ['La contraseña es demasiado común.'] } }
    const { user } = renderApp('/administrador/usuarios/nuevo')
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
    renderApp('/administrador/usuarios/3')

    expect(await screen.findByText(/solo se gestionan mediante el procedimiento técnico de TI/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Desactivar cuenta/ })).not.toBeInTheDocument()
  })

  it('confirma la desactivación e informa si hay asignaciones vigentes', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administrador/usuarios/10')
    await screen.findByRole('heading', { name: 'Tec Prueba', level: 1 })

    await user.click(screen.getByRole('button', { name: 'Desactivar cuenta' }))
    const dialog = await screen.findByRole('alertdialog', { name: '¿Desactivar la cuenta?' })
    expect(writes()).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar' }))

    expect(await screen.findByText(/tiene asignaciones vigentes/)).toBeInTheDocument()
  })

  it('restablece la contraseña tras confirmar, sin mostrarla', async () => {
    signIn(USERS.administrador)
    const { user } = renderApp('/administrador/usuarios/11')
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
  it('el Administrador ve indicadores de todas las áreas', async () => {
    signIn(USERS.administrador)
    renderApp('/administrador')

    expect(await screen.findByText('Todas las áreas', { selector: 'strong' })).toBeInTheDocument()
    const tickets = screen.getByRole('region', { name: 'Incidencias (por ticket)' })
    expect(within(tickets).getByText('Pendientes de gestión')).toBeInTheDocument()
    expect(screen.getByText(/^5[.,]5 h$/)).toBeInTheDocument()
    expect(screen.getByText(/No hay plazos de atención \(SLA\) definidos/)).toBeInTheDocument()
  })

  it('el Planificador ve solo sus áreas autorizadas', async () => {
    signIn(USERS.multirol)
    renderApp('/planificador/indicadores')

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
    const { user } = renderApp('/administrador')

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
    const { user } = renderApp('/administrador')

    await user.click(await screen.findByRole('button', { name: 'Descargar Pendientes en Excel' }))

    expect(await screen.findByText(/supera 5000 filas/)).toBeInTheDocument()
  })
})
