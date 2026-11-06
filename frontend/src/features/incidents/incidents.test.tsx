import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createIncident } from './api'

import { backend, USERS } from '../../test/fakeBackend'
import { incidentsBackend } from '../../test/fakeIncidents'
import { renderApp } from '../../test/renderApp'

function signInSolicitante() {
  backend.signIn(USERS.solicitante)
  document.cookie = `csrftoken=${backend.csrfToken}; path=/`
}

async function openForm() {
  signInSolicitante()
  const utils = renderApp('/solicitante/incidencias/nueva')
  await screen.findByRole('heading', { name: 'Registrar incidencia' })
  return utils
}

async function fillValidForm(user: Awaited<ReturnType<typeof openForm>>['user']) {
  await user.selectOptions(screen.getByLabelText(/UPS o servicio/), '[DEMO] Laboratorio')
  await user.click(screen.getByRole('radio', { name: /Mantenimiento/ }))
  await user.type(
    screen.getByLabelText(/Descripción del problema/),
    'La puerta del laboratorio no cierra correctamente.',
  )
}

function photo(name: string, type: string, size = 1024) {
  return new File([new Uint8Array(size)], name, { type })
}

describe('vista Solicitante', () => {
  it('ofrece registrar y consultar incidencias', async () => {
    signInSolicitante()
    renderApp('/solicitante')

    expect(await screen.findByRole('link', { name: /Registrar incidencia/ })).toHaveAttribute(
      'href',
      '/solicitante/incidencias/nueva',
    )
    expect(screen.getByRole('link', { name: /Mis incidencias/ })).toHaveAttribute(
      'href',
      '/solicitante/incidencias',
    )
  })

  it('sin el rol solicitante, el formulario no está disponible', async () => {
    backend.signIn(USERS.multirol) // planificador + personal_atencion
    renderApp('/solicitante/incidencias/nueva')

    expect(
      await screen.findByRole('heading', { name: 'No tienes acceso a esta vista' }),
    ).toBeInTheDocument()
  })
})

describe('formulario de registro', () => {
  it('carga las UPS y áreas de soporte, e identifica el catálogo de demostración', async () => {
    await openForm()

    expect(screen.getByRole('option', { name: '[DEMO] Emergencia' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'ingenieria_clinica',
      'mantenimiento',
      'ti',
    ])
    expect(screen.getByText('Catálogo de demostración')).toBeInTheDocument()
  })

  it('no incluye campos de diagnóstico técnico ni de estado', async () => {
    await openForm()

    expect(screen.queryByLabelText(/diagn/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/estado/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/prioridad/i)).not.toBeInTheDocument()
  })

  it('valida los campos obligatorios sin enviar nada', async () => {
    const { user } = await openForm()

    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))

    expect(screen.getByText('Selecciona la UPS o servicio.')).toBeInTheDocument()
    expect(screen.getByText('Selecciona el área de soporte.')).toBeInTheDocument()
    expect(screen.getByText('Describe el problema.')).toBeInTheDocument()
    expect(screen.getByLabelText(/UPS o servicio/)).toHaveFocus()
    expect(incidentsBackend.submissions).toHaveLength(0)
  })

  it('exige una descripción de al menos 10 caracteres', async () => {
    const { user } = await openForm()
    await user.selectOptions(screen.getByLabelText(/UPS o servicio/), '[DEMO] Emergencia')
    await user.click(screen.getByRole('radio', { name: /TI/ }))
    await user.type(screen.getByLabelText(/Descripción del problema/), 'corta')

    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))

    expect(
      screen.getByText('La descripción debe tener al menos 10 caracteres.'),
    ).toBeInTheDocument()
    expect(incidentsBackend.submissions).toHaveLength(0)
  })

  it('rechaza archivos que no son imágenes permitidas o que superan 5 MB', async () => {
    await openForm()
    // Simula un navegador que no filtra por el atributo accept.
    const user = userEvent.setup({ applyAccept: false })
    const input = screen.getByLabelText('Fotografía')

    await user.upload(input, photo('documento.pdf', 'application/pdf'))
    expect(screen.getByText('Usa una fotografía JPG, PNG o WebP.')).toBeInTheDocument()

    await user.upload(input, photo('grande.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1))
    expect(screen.getByText('La imagen supera el tamaño máximo de 5 MB.')).toBeInTheDocument()
  })

  it('muestra la foto elegida y permite quitarla', async () => {
    const { user } = await openForm()

    await user.upload(screen.getByLabelText('Fotografía'), photo('puerta.jpg', 'image/jpeg', 2048))
    expect(screen.getByText('puerta.jpg · 2 KB')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Quitar' }))
    expect(screen.queryByText(/puerta\.jpg/)).not.toBeInTheDocument()
  })

  it('envía la foto en multipart, sin estado ni autor (FormData construido)', async () => {
    // jsdom no puede serializar archivos con el fetch de Node: se inspecciona el FormData.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } }))
    document.cookie = 'csrftoken=token-de-prueba; path=/'

    await createIncident({
      careUnit: 'demo-emergencia',
      supportArea: 'ti',
      description: '  Descripción con espacios alrededor.  ',
      priorActions: '',
      assetReference: 'DEMO-01',
      photo: photo('foto.png', 'image/png'),
    })

    const [, init] = fetchSpy.mock.calls[0]
    const body = init?.body as FormData
    const headers = init?.headers as Headers
    expect(body).toBeInstanceOf(FormData)
    expect([...body.keys()]).toEqual([
      'care_unit',
      'support_area',
      'description',
      'asset_reference',
      'photo',
    ])
    expect(body.get('description')).toBe('Descripción con espacios alrededor.')
    expect((body.get('photo') as File).name).toBe('foto.png')
    expect(headers.get('Content-Type')).toBeNull() // el navegador fija el boundary multipart
    expect(headers.get('X-CSRFToken')).toBe('token-de-prueba')
    expect(headers.get('X-SGIM-Passive')).toBeNull()
    fetchSpy.mockRestore()
  })

  it('registra la incidencia con CSRF y petición activa, y muestra el código', async () => {
    const { user } = await openForm()
    await fillValidForm(user)
    await user.type(screen.getByLabelText(/Equipo o activo/), 'DEMO-PUERTA-03')

    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))

    expect(await screen.findByTestId('incident-code')).toHaveTextContent('INC-2026-000001')
    expect(
      screen.getByRole('heading', { name: 'Tu incidencia se registró correctamente' }),
    ).toHaveFocus()

    const [submission] = incidentsBackend.submissions
    expect(submission.fields).toEqual({
      care_unit: 'demo-laboratorio',
      support_area: 'mantenimiento',
      description: 'La puerta del laboratorio no cierra correctamente.',
      asset_reference: 'DEMO-PUERTA-03',
    })
    expect(submission.fileName).toBeNull()
    expect(submission.csrfHeader).toBe(backend.csrfToken)
    expect(submission.passive).toBe(false) // registrar es una acción del usuario
    expect(Object.keys(submission.fields)).not.toContain('status')
    expect(Object.keys(submission.fields)).not.toContain('created_by')
  })

  it('desde la confirmación se puede ver el detalle', async () => {
    const { user } = await openForm()
    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))

    await user.click(await screen.findByRole('link', { name: 'Ver detalle' }))

    expect(await screen.findByRole('heading', { name: 'INC-2026-000001' })).toBeInTheDocument()
    expect(screen.getByText('La puerta del laboratorio no cierra correctamente.')).toBeInTheDocument()
  })

  it('muestra los errores de validación del servidor en sus campos', async () => {
    incidentsBackend.serverErrors = {
      care_unit: ['La UPS o servicio seleccionado no es válido.'],
      photo: ['El archivo no es una imagen válida. Usa una fotografía JPG, PNG o WebP.'],
    }
    const { user } = await openForm()
    await fillValidForm(user)

    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))

    expect(await screen.findByText('Revisa los campos marcados.')).toBeInTheDocument()
    expect(screen.getByText('La UPS o servicio seleccionado no es válido.')).toBeInTheDocument()
    expect(screen.getByText(/no es una imagen válida/)).toBeInTheDocument()
  })

  it('informa un error de red sin perder lo escrito', async () => {
    const { user } = await openForm()
    await fillValidForm(user)
    backend.networkDown = true

    await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Tu incidencia no se registró')
    expect(screen.getByLabelText(/Descripción del problema/)).toHaveValue(
      'La puerta del laboratorio no cierra correctamente.',
    )
  })
})

describe('mis incidencias', () => {
  it('lista solo las incidencias propias, con enlace al detalle', async () => {
    incidentsBackend.seed(USERS.solicitante.username)
    incidentsBackend.seed('otro.usuario')
    incidentsBackend.seed(USERS.solicitante.username)
    signInSolicitante()
    renderApp('/solicitante/incidencias')

    const table = await screen.findByRole('table')
    const codes = within(table)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(codes).toEqual(['INC-2026-000003', 'INC-2026-000001'])
    expect(within(table).getAllByRole('row')).toHaveLength(3) // encabezado + 2 filas
    expect(within(table).queryByText('INC-2026-000002')).not.toBeInTheDocument()
  })

  it('muestra un estado vacío si no hay incidencias', async () => {
    signInSolicitante()
    renderApp('/solicitante/incidencias')

    expect(
      await screen.findByRole('heading', { name: 'Todavía no registraste incidencias' }),
    ).toBeInTheDocument()
  })

  it('el detalle muestra los datos registrados y el historial', async () => {
    incidentsBackend.seed(USERS.solicitante.username, {
      prior_actions: 'Se reinició el equipo.',
      asset_reference: 'DEMO-PC-07',
    })
    signInSolicitante()
    renderApp('/solicitante/incidencias/inc-2026-000001')

    expect(await screen.findByRole('heading', { name: 'INC-2026-000001' })).toBeInTheDocument()
    expect(screen.getByText('Se reinició el equipo.')).toBeInTheDocument()
    expect(screen.getByText('DEMO-PC-07')).toBeInTheDocument()
    expect(screen.getByText('No se adjuntaron imágenes.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Historial' })).toBeInTheDocument()
  })

  it('una incidencia ajena o inexistente se informa como no encontrada', async () => {
    incidentsBackend.seed('otro.usuario')
    signInSolicitante()
    renderApp('/solicitante/incidencias/INC-2026-000001')

    expect(await screen.findByText('No encontramos esta incidencia')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Descripción ficticia de una incidencia de prueba.')).toBeNull(),
    )
  })
})
