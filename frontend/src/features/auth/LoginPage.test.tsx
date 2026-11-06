import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { backend, TEST_PASSWORD, USERS } from '../../test/fakeBackend'
import { fillLogin, renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

describe('pantalla de inicio de sesión', () => {
  it('muestra el formulario con campos accesibles', async () => {
    renderApp('/login')

    expect(await screen.findByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(screen.getByLabelText(/usuario/i)).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText(/^contraseña/i)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/^contraseña/i)).toHaveAttribute('autocomplete', 'current-password')
  })

  it('valida los campos obligatorios sin llamar al servidor', async () => {
    const { user } = renderApp('/login')

    await user.click(await screen.findByRole('button', { name: /ingresar/i }))

    expect(screen.getByText('Ingresa tu nombre de usuario.')).toBeInTheDocument()
    expect(screen.getByText('Ingresa tu contraseña.')).toBeInTheDocument()
    expect(screen.getByLabelText(/usuario/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText(/usuario/i)).toHaveFocus()
    expect(backend.requestsTo('/auth/login/')).toHaveLength(0)
  })

  it('permite mostrar y ocultar la contraseña', async () => {
    const { user } = renderApp('/login')
    const password = await screen.findByLabelText(/^contraseña/i)
    const toggle = screen.getByRole('button', { name: /mostrar contraseña/i })

    await user.click(toggle)
    expect(password).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: /ocultar contraseña/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(screen.getByRole('button', { name: /ocultar contraseña/i }))
    expect(password).toHaveAttribute('type', 'password')
  })

  it('inicia sesión correctamente y muestra la pantalla inicial', async () => {
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')

    expect(await screen.findByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument()
  })

  it('obtiene el token CSRF antes del login y lo envía en X-CSRFToken', async () => {
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')
    await screen.findByRole('heading', { name: 'Hola, Ana' })

    const csrf = backend.requestsTo('/auth/csrf/')
    const login = backend.requestsTo('/auth/login/')
    expect(csrf).toHaveLength(1)
    expect(csrf[0].passive).toBe(true) // obtener el token no cuenta como actividad
    expect(login).toHaveLength(1)
    expect(login[0].csrfHeader).toBe('csrf-inicial')
    expect(backend.requests.indexOf(csrf[0])).toBeLessThan(backend.requests.indexOf(login[0]))
  })

  it('muestra un indicador de carga mientras inicia sesión', async () => {
    let release: () => void = () => undefined
    server.use(
      http.post('*/api/v1/auth/login/', async () => {
        await new Promise<void>((resolve) => (release = resolve))
        return HttpResponse.json(USERS.solicitante)
      }),
    )
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')

    const button = await screen.findByRole('button', { name: /ingresando/i })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    release()
  })

  it('informa credenciales incorrectas sin revelar si el usuario existe', async () => {
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba', 'clave-incorrecta')

    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.')
    expect(screen.getByLabelText(/usuario/i)).toHaveValue('ana.prueba')
    expect(screen.getByLabelText(/^contraseña/i)).toHaveValue('') // la contraseña no se conserva
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument()
  })

  it('informa errores de red', async () => {
    backend.networkDown = true
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo conectar con el servidor',
    )
  })

  it('informa el límite de intentos y bloquea el botón durante la espera', async () => {
    backend.throttleRetryAfter = 30
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('demasiados intentos')
    expect(alert).toHaveTextContent(/Podrás intentarlo de nuevo en 3\d s/)
    expect(screen.getByRole('button', { name: /ingresar/i })).toBeDisabled()
  })

  it('ante un rechazo CSRF informa y no reintenta automáticamente', async () => {
    server.use(
      http.get('*/api/v1/auth/csrf/', ({ request }) => {
        backend.requests.push({
          method: 'GET',
          path: new URL(request.url).pathname,
          passive: true,
          csrfHeader: null,
        })
        return new HttpResponse(null, { status: 204 }) // no entrega cookie
      }),
    )
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo verificar la seguridad de la solicitud',
    )
    expect(backend.requestsTo('/auth/login/')).toHaveLength(1)
  })

  it('no guarda credenciales ni identificadores en el almacenamiento del navegador', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')
    await screen.findByRole('heading', { name: 'Hola, Ana' })

    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage).toHaveLength(0)
    expect(sessionStorage).toHaveLength(0)
    expect(document.cookie).not.toContain(TEST_PASSWORD)
    expect(document.cookie).not.toMatch(/sessionid/i) // la cookie de sesión es HttpOnly
    setItem.mockRestore()
  })

  it('si ya hay sesión, redirige a la pantalla inicial', async () => {
    backend.signIn(USERS.solicitante)
    renderApp('/login')

    expect(await screen.findByRole('heading', { name: 'Hola, Ana' })).toBeInTheDocument()
  })

  it('no envía la contraseña en la URL ni la deja en el formulario tras el login', async () => {
    const { user } = renderApp('/login')

    await fillLogin(user, 'ana.prueba')
    await screen.findByRole('heading', { name: 'Hola, Ana' })

    await waitFor(() => expect(screen.queryByLabelText(/^contraseña/i)).not.toBeInTheDocument())
    expect(backend.requests.every((request) => !request.path.includes(TEST_PASSWORD))).toBe(true)
  })
})
