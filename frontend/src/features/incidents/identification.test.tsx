import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { backend, USERS } from '../../test/fakeBackend'
import { incidentsBackend } from '../../test/fakeIncidents'
import { renderApp } from '../../test/renderApp'
import { cameraError, cameraSupport, createQrDecoder } from './camera'
import { validateEquipment } from './equipment'

// --- Cámara simulada ------------------------------------------------------------

const stopTrack = vi.fn()

function fakeStream() {
  return { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream
}

function installCamera(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(getUserMedia) },
    configurable: true,
  })
}

function installBarcodeDetector(results: string[]) {
  const queue = [...results]
  class FakeBarcodeDetector {
    static getSupportedFormats = async () => ['qr_code']
    async detect() {
      const next = queue.shift()
      return next === undefined ? [] : [{ rawValue: next }]
    }
  }
  Object.defineProperty(globalThis, 'BarcodeDetector', {
    value: FakeBarcodeDetector,
    configurable: true,
  })
}

function removeCamera() {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Reflect.deleteProperty(globalThis, 'BarcodeDetector')
}

beforeEach(() => {
  // jsdom no reproduce video.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  removeCamera()
})

afterEach(() => {
  vi.restoreAllMocks()
  stopTrack.mockReset()
  removeCamera()
})

// --- Ayudantes ------------------------------------------------------------------

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

const qrInput = () => screen.queryByLabelText(/Contenido del código QR/)
const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Registrar incidencia' }))

function photoFile() {
  return new File([new Uint8Array(1024)], 'puerta.jpg', { type: 'image/jpeg' })
}

/** Intercepta el POST de registro (con archivo) y devuelve el FormData enviado. */
function captureIncidentPost() {
  const realFetch = globalThis.fetch
  let body: FormData | null = null
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.method === 'POST' && url.endsWith('/api/v1/incidents/')) {
      body = init.body as FormData
      const created = incidentsBackend.seed(USERS.solicitante.username)
      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return realFetch(input, init)
  })
  return () => {
    if (!body) throw new Error('No se envió el registro.')
    return body
  }
}

// --- Estructura -----------------------------------------------------------------

describe('identificación del equipo: estructura', () => {
  it('presenta dos opciones principales con el texto de apoyo', async () => {
    await openForm()

    expect(screen.getByText('Agiliza el registro si el activo está identificado.')).toBeInTheDocument()
    const group = screen.getByRole('radiogroup', { name: '¿El equipo tiene código QR?' })
    expect(within(group).getAllByRole('radio')).toHaveLength(2)
    expect(within(group).getByRole('radio', { name: /No tiene QR \/ No aplica/ })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Equipo o activo/)).not.toBeInTheDocument()
  })

  it('sin cámara (escritorio o navegador sin soporte) ofrece solo el ingreso manual', async () => {
    const { user } = await openForm()

    expect(screen.queryByRole('radio', { name: /Escanear QR/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Código QR.*Escribir el contenido/ }))

    expect(qrInput()).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Abrir cámara/ })).not.toBeInTheDocument()
  })

  it('con cámara disponible ofrece "Escanear QR · Usar cámara"', async () => {
    installCamera(async () => fakeStream())
    const { user } = await openForm()

    await user.click(screen.getByRole('radio', { name: /Escanear QR.*Usar cámara/ }))

    expect(screen.getByRole('button', { name: 'Abrir cámara' })).toBeInTheDocument()
    expect(qrInput()).toBeInTheDocument() // el ingreso manual sigue disponible
  })

  it('la elección es obligatoria y el error aparece debajo', async () => {
    const { user } = await openForm()

    await submit(user)

    expect(screen.getByText('Indica si el equipo tiene código QR.')).toBeInTheDocument()
    expect(incidentsBackend.submissions).toHaveLength(0)
  })
})

// --- Escaneo --------------------------------------------------------------------

describe('escaneo con la cámara', () => {
  it('lee el QR, completa el campo como texto y lo envía como "scan"', async () => {
    installCamera(async () => fakeStream())
    installBarcodeDetector(['https://ejemplo.test/equipo?id=FICTICIO'])
    const openSpy = vi.spyOn(window, 'open')
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Escanear QR/ }))

    await user.click(screen.getByRole('button', { name: 'Abrir cámara' }))

    await waitFor(() => expect(qrInput()).toHaveValue('https://ejemplo.test/equipo?id=FICTICIO'))
    expect(screen.queryByRole('dialog', { name: 'Escanear código QR' })).not.toBeInTheDocument()
    expect(stopTrack).toHaveBeenCalled() // la cámara se libera
    expect(openSpy).not.toHaveBeenCalled() // nunca se abre el enlace
    expect(screen.getByText(/Leído con la cámara/)).toBeInTheDocument()

    await submit(user)
    await screen.findByTestId('incident-code')
    expect(incidentsBackend.submissions[0].fields).toMatchObject({
      equipment_qr_status: 'qr_readable',
      qr_code: 'https://ejemplo.test/equipo?id=FICTICIO',
      qr_capture_method: 'scan',
    })
  })

  it('muestra la vista de escaneo y permite cancelar', async () => {
    installCamera(async () => fakeStream())
    installBarcodeDetector([])
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Escanear QR/ }))
    await user.click(screen.getByRole('button', { name: 'Abrir cámara' }))

    const dialog = await screen.findByRole('dialog', { name: 'Escanear código QR' })
    expect(await within(dialog).findByText(/Apunta la cámara/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(stopTrack).toHaveBeenCalled()
    expect(qrInput()).toHaveValue('')
  })

  it('si el usuario corrige el código leído, se envía como "manual"', async () => {
    installCamera(async () => fakeStream())
    installBarcodeDetector(['QR-LEIDO'])
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Escanear QR/ }))
    await user.click(screen.getByRole('button', { name: 'Abrir cámara' }))
    await waitFor(() => expect(qrInput()).toHaveValue('QR-LEIDO'))

    await user.type(qrInput()!, '-2')
    await submit(user)

    await screen.findByTestId('incident-code')
    expect(incidentsBackend.submissions[0].fields).toMatchObject({
      qr_code: 'QR-LEIDO-2',
      qr_capture_method: 'manual',
    })
  })

  it('si el permiso se deniega, lo explica y ofrece el ingreso manual', async () => {
    installCamera(async () => {
      throw new DOMException('Permiso denegado', 'NotAllowedError')
    })
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Escanear QR/ }))

    await user.click(screen.getByRole('button', { name: 'Abrir cámara' }))

    expect(await screen.findByText(/No se dio permiso para usar la cámara/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(qrInput()).toHaveFocus()
  })

  it('si no hay cámara, lo explica y ofrece el ingreso manual', async () => {
    installCamera(async () => {
      throw new DOMException('Sin cámara', 'NotFoundError')
    })
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Escanear QR/ }))

    await user.click(screen.getByRole('button', { name: 'Abrir cámara' }))

    expect(await screen.findByText(/No se encontró una cámara/)).toBeInTheDocument()
    await user.type(qrInput()!, 'QR-MANUAL-1')
    await submit(user)
    await screen.findByTestId('incident-code')
    expect(incidentsBackend.submissions[0].fields.qr_capture_method).toBe('manual')
  })

  it('rechaza un QR leído con caracteres invisibles y pide escribirlo', async () => {
    installCamera(async () => fakeStream())
    installBarcodeDetector(['QR‮FALSO'])
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Escanear QR/ }))

    await user.click(screen.getByRole('button', { name: 'Abrir cámara' }))

    expect(await screen.findByText(/El QR leído no se puede usar/)).toBeInTheDocument()
    expect(qrInput()).toHaveValue('')
  })
})

// --- Ingreso manual y "No tiene QR / No aplica" ---------------------------------

describe('ingreso manual y opciones sin QR', () => {
  it('con QR exige el contenido', async () => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Código QR/ }))

    await submit(user)

    expect(screen.getByText('Escribe o escanea el contenido del código QR.')).toBeInTheDocument()
    expect(qrInput()).toHaveFocus()
    expect(incidentsBackend.submissions).toHaveLength(0)
  })

  it('"No tiene QR / No aplica" exige elegir el motivo', async () => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /No tiene QR \/ No aplica/ }))

    await submit(user)

    expect(screen.getByText('Selecciona el motivo.')).toBeInTheDocument()
    expect(incidentsBackend.submissions).toHaveLength(0)
  })

  it.each([
    ['Tiene QR, pero no puedo leerlo', 'qr_unreadable'],
    ['El equipo no tiene QR', 'no_qr'],
    ['No corresponde a un equipo', 'not_equipment'],
  ])('"%s" exige una fotografía y luego permite enviar', async (label, value) => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /No tiene QR \/ No aplica/ }))
    await user.click(screen.getByRole('radio', { name: label }))

    await submit(user)
    expect(screen.getByText(/es obligatoria cuando no hay un QR legible/)).toBeInTheDocument()
    expect(screen.getByLabelText('Fotografía')).toHaveFocus()
    expect(incidentsBackend.submissions).toHaveLength(0)

    await user.upload(screen.getByLabelText('Fotografía'), photoFile())
    // jsdom no puede enviar un File con el fetch de Node: se intercepta solo este POST
    // y se inspecciona el FormData real que construye el formulario.
    const sent = captureIncidentPost()
    await submit(user)

    await screen.findByTestId('incident-code')
    const body = sent()
    expect(body.get('equipment_qr_status')).toBe(value)
    expect(body.has('qr_code')).toBe(false)
    expect(body.has('qr_capture_method')).toBe(false)
    expect((body.get('photo') as File).name).toBe('puerta.jpg')
  })

  it('al cambiar de opción descarta el código y el motivo', async () => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Código QR/ }))
    await user.type(qrInput()!, 'QR-QUE-NO-SE-ENVIA')
    await user.click(screen.getByRole('radio', { name: /No tiene QR \/ No aplica/ }))
    await user.click(screen.getByRole('radio', { name: 'El equipo no tiene QR' }))
    await user.click(screen.getByRole('radio', { name: /Código QR/ }))
    expect(qrInput()).toHaveValue('')
    await user.click(screen.getByRole('radio', { name: /No tiene QR \/ No aplica/ }))
    expect(screen.getByRole('radio', { name: 'El equipo no tiene QR' })).not.toBeChecked()
  })

  it('rechaza saltos de línea y caracteres invisibles escritos', async () => {
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Código QR/ }))
    fireEvent.change(qrInput()!, { target: { value: 'QR‮FALSO' } })

    await submit(user)

    expect(screen.getByText(/caracteres no permitidos/)).toBeInTheDocument()
    expect(incidentsBackend.submissions).toHaveLength(0)
  })

  it('muestra en su campo el error de fotografía del servidor', async () => {
    incidentsBackend.serverErrors = {
      photo: ['Adjunta una fotografía de la incidencia: es obligatoria cuando no hay un QR legible.'],
    }
    const { user } = await openForm()
    await user.click(screen.getByRole('radio', { name: /Código QR/ }))
    await user.type(qrInput()!, 'QR-1')

    await submit(user)

    expect(await screen.findByText('Revisa los campos marcados.')).toBeInTheDocument()
    expect(screen.getByText(/es obligatoria cuando no hay un QR legible/)).toBeInTheDocument()
  })
})

// --- Reglas y utilidades ---------------------------------------------------------

describe('reglas del navegador', () => {
  it('coinciden con las del servidor', () => {
    expect(validateEquipment('', '', '')).toEqual({
      equipmentMode: 'Indica si el equipo tiene código QR.',
    })
    expect(validateEquipment('none', '', '')).toEqual({ noQrReason: 'Selecciona el motivo.' })
    expect(validateEquipment('none', 'no_qr', '')).toEqual({})
    expect(validateEquipment('qr', '', '   ')).toHaveProperty('qrCode')
    expect(validateEquipment('qr', '', 'Q'.repeat(256))).toHaveProperty('qrCode')
    expect(validateEquipment('qr', '', 'Q'.repeat(255))).toEqual({})
    expect(validateEquipment('qr', '', 'QR\n2')).toHaveProperty('qrCode')
  })

  it('detecta si la cámara se puede ofrecer', () => {
    expect(cameraSupport()).toBe('unsupported')
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    expect(cameraSupport()).toBe('insecure')
    installCamera(async () => fakeStream())
    expect(cameraSupport()).toBe('available')
  })

  it('sin BarcodeDetector usa jsQR, cargado solo cuando hace falta', async () => {
    const decoder = await createQrDecoder()
    const video = document.createElement('video') // sin fotograma todavía

    await expect(decoder.decode(video)).resolves.toBeNull()
  })

  it('con BarcodeDetector usa el lector nativo', async () => {
    installBarcodeDetector(['QR-NATIVO'])
    const decoder = await createQrDecoder()

    await expect(decoder.decode(document.createElement('video'))).resolves.toBe('QR-NATIVO')
  })

  it('traduce los errores de la cámara', () => {
    expect(cameraError(new DOMException('', 'NotAllowedError')).kind).toBe('denied')
    expect(cameraError(new DOMException('', 'NotFoundError')).kind).toBe('not-found')
    expect(cameraError(new DOMException('', 'NotReadableError')).kind).toBe('busy')
    expect(cameraError(new Error('x')).kind).toBe('other')
  })
})

// --- Detalle ----------------------------------------------------------------------

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
    expect(within(screen.getByTestId('qr-code')).queryByRole('link')).toBeNull()
    expect(document.querySelector('a[href^="https://ejemplo.test"]')).toBeNull()
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
