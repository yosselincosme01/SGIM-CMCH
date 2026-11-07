import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { incidentsBackend } from '../../test/fakeIncidents'
import { renderApp } from '../../test/renderApp'
import { validateEquipment } from './equipment'

function signInSolicitante() {
  backend.signIn(USERS.solicitante)
  document.cookie = `csrftoken=${backend.csrfToken}; path=/`
}

async function openForm() {
  signInSolicitante()
  const utils = renderApp('/solicitante/incidencias/nueva')
  await screen.findByRole('heading', { name: 'Registrar incidencia' })
  const { user } = utils
  await user.selectOptions(screen.getByLabelText(/UPS o servicio/), '[DEMO] Emergencia')
  await user.click(screen.getByRole('radio', { name: /^TI/ }))
  await user.type(
    screen.getByLabelText(/Descripción del problema/),
    'El monitor de signos vitales no enciende.',
  )
  return utils
}

function qrInput() {
  return screen.queryByLabelText(/Contenido del código QR/)
}

async function submit(user: Awaited<ReturnType<typeof openForm>>['user']) {
  await user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))
}

describe('identificación del equipo', () => {
  it('presenta las cuatro opciones y ningún botón de escaneo', async () => {
    await openForm()

    const group = screen.getByRole('radiogroup', { name: '¿El equipo tiene código QR?' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.getAttribute('value')),
    ).toEqual(['qr_readable', 'qr_unreadable', 'no_qr', 'not_equipment'])
    expect(screen.queryByLabelText(/Equipo o activo/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /escane|cámara|camara/i })).not.toBeInTheDocument()
    expect(qrInput()).not.toBeInTheDocument()
  })

  it('la identificación es obligatoria', async () => {
    const { user } = await openForm()

    await submit(user)

    expect(screen.getByText('Indica si el equipo tiene código QR.')).toBeInTheDocument()
    expect(incidentsBackend.submissions).toHaveLength(0)
  })

  it('con QR legible exige el contenido y lo envía sin espacios en los extremos', async () => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Tiene QR y puedo leerlo/ }))

    await submit(user)
    expect(screen.getByText('Escribe el contenido del código QR.')).toBeInTheDocument()
    expect(qrInput()).toHaveFocus()
    expect(incidentsBackend.submissions).toHaveLength(0)

    await user.type(qrInput()!, '  QR-FICTICIO-77  ')
    await submit(user)

    expect(await screen.findByTestId('incident-code')).toBeInTheDocument()
    expect(incidentsBackend.submissions[0].fields).toMatchObject({
      equipment_qr_status: 'qr_readable',
      qr_code: 'QR-FICTICIO-77',
    })
    expect(incidentsBackend.submissions[0].fields).not.toHaveProperty('qr_capture_method')
  })

  it.each([
    ['Tiene QR, pero no puedo leerlo', 'qr_unreadable'],
    ['El equipo no tiene QR', 'no_qr'],
    ['No corresponde a un equipo', 'not_equipment'],
  ])('"%s" permite continuar sin código', async (label, value) => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: new RegExp(label) }))
    expect(qrInput()).not.toBeInTheDocument()

    await submit(user)

    expect(await screen.findByTestId('incident-code')).toBeInTheDocument()
    const { fields } = incidentsBackend.submissions[0]
    expect(fields.equipment_qr_status).toBe(value)
    expect(fields).not.toHaveProperty('qr_code')
    expect(fields).not.toHaveProperty('asset_reference')
  })

  it('al cambiar de opción descarta el código escrito y no lo envía', async () => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Tiene QR y puedo leerlo/ }))
    await user.type(qrInput()!, 'QR-QUE-NO-SE-ENVIA')
    await user.click(screen.getByRole('radio', { name: /El equipo no tiene QR/ }))
    await user.click(screen.getByRole('radio', { name: /Tiene QR y puedo leerlo/ }))
    expect(qrInput()).toHaveValue('')

    await user.click(screen.getByRole('radio', { name: /El equipo no tiene QR/ }))
    await submit(user)

    await screen.findByTestId('incident-code')
    expect(JSON.stringify(incidentsBackend.submissions[0].fields)).not.toContain('QR-QUE-NO')
  })

  it('rechaza saltos de línea y caracteres invisibles', async () => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Tiene QR y puedo leerlo/ }))
    fireEvent.change(qrInput()!, { target: { value: 'QR‮FALSO' } })

    await submit(user)

    expect(screen.getByText(/caracteres no permitidos/)).toBeInTheDocument()
    expect(incidentsBackend.submissions).toHaveLength(0)
  })

  it('muestra en su campo el error del servidor sobre el QR', async () => {
    incidentsBackend.serverErrors = { qr_code: ['Escribe el contenido del código QR.'] }
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Tiene QR y puedo leerlo/ }))
    await user.type(qrInput()!, 'QR-1')

    await submit(user)

    expect(await screen.findByText('Revisa los campos marcados.')).toBeInTheDocument()
    expect(screen.getByText('Escribe el contenido del código QR.')).toBeInTheDocument()
  })

  it('las reglas del navegador coinciden con las del servidor', () => {
    expect(validateEquipment('', '')).toEqual({
      equipmentQrStatus: 'Indica si el equipo tiene código QR.',
    })
    expect(validateEquipment('unspecified', '')).toHaveProperty('equipmentQrStatus')
    expect(validateEquipment('qr_readable', '   ')).toHaveProperty('qrCode')
    expect(validateEquipment('qr_readable', 'Q'.repeat(256))).toHaveProperty('qrCode')
    expect(validateEquipment('qr_readable', 'Q'.repeat(255))).toEqual({})
    expect(validateEquipment('qr_readable', 'QR\n2')).toHaveProperty('qrCode')
    expect(validateEquipment('no_qr', '')).toEqual({})
  })
})

describe('identificación en el detalle', () => {
  it('muestra el contenido del QR como texto, nunca como enlace', async () => {
    const url = 'https://ejemplo.test/equipo?id=FICTICIO'
    incidentsBackend.seed(USERS.solicitante.username, {
      equipment_qr_status: 'qr_readable',
      equipment_qr_status_label: 'Tiene QR y puedo leerlo',
      qr_code: url,
    })
    signInSolicitante()
    renderApp('/solicitante/incidencias/INC-2026-000001')

    expect(await screen.findByTestId('qr-code')).toHaveTextContent(url)
    expect(screen.getByText('Tiene QR y puedo leerlo')).toBeInTheDocument()
    expect(within(screen.getByTestId('qr-code')).queryByRole('link')).toBeNull()
    expect(document.querySelector(`a[href^="https://ejemplo.test"]`)).toBeNull()
  })

  it('las incidencias anteriores muestran que no tienen dato de identificación', async () => {
    incidentsBackend.seed(USERS.solicitante.username, {
      equipment_qr_status: 'unspecified',
      equipment_qr_status_label: 'Sin dato de identificación (incidencia anterior)',
      qr_code: '',
    })
    signInSolicitante()
    renderApp('/solicitante/incidencias/INC-2026-000001')

    expect(
      await screen.findByText('Sin dato de identificación (incidencia anterior)'),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('qr-code')).not.toBeInTheDocument()
  })
})
