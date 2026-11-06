import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { InstitutionLogo } from '../../shared/ui/InstitutionLogo'
import { PasswordField } from '../../shared/ui/PasswordField'
import { TextField } from '../../shared/ui/TextField'
import { loginErrorMessage, noticeMessage } from './messages'
import { safeRedirectTarget } from './redirect'
import type { LoginRedirectState } from './RequireAuth'
import { useAuth } from './useAuth'

interface FieldErrors {
  username?: string
  password?: string
}

const DEFAULT_THROTTLE_SECONDS = 60

export function LoginPage() {
  useDocumentTitle('Iniciar sesión')
  const { state, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = safeRedirectTarget((location.state as LoginRedirectState | null)?.from)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [retryAt, setRetryAt] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  const usernameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  // Cuenta regresiva tras un 429: el botón queda deshabilitado hasta que termine.
  useEffect(() => {
    if (retryAt === null) return
    const update = () => {
      const left = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
      setSecondsLeft(left)
      if (left === 0) setRetryAt(null)
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [retryAt])

  useEffect(() => {
    if (formError) errorRef.current?.focus()
  }, [formError])

  if (state.status === 'authenticated') {
    return <Navigate to={redirectTo} replace />
  }

  const notice = state.status === 'anonymous' && state.notice ? noticeMessage(state.notice) : null
  const throttled = retryAt !== null && secondsLeft > 0

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || throttled) return

    const errors: FieldErrors = {}
    if (!username.trim()) errors.username = 'Ingresa tu nombre de usuario.'
    if (!password) errors.password = 'Ingresa tu contraseña.'
    setFieldErrors(errors)
    setFormError(null)
    if (errors.username) return usernameRef.current?.focus()
    if (errors.password) return passwordRef.current?.focus()

    setSubmitting(true)
    try {
      await login({ username: username.trim(), password })
      setPassword('')
      navigate(redirectTo, { replace: true })
    } catch (error) {
      // La contraseña nunca se conserva tras un intento fallido.
      setPassword('')
      if (!isApiError(error)) {
        setFormError('No se pudo iniciar sesión. Inténtalo de nuevo.')
        return
      }
      if (error.kind === 'throttled') {
        const seconds = error.retryAfterSeconds ?? DEFAULT_THROTTLE_SECONDS
        setRetryAt(Date.now() + seconds * 1000)
        setSecondsLeft(seconds)
      }
      if (error.kind === 'validation' && !error.fieldErrors.non_field_errors) {
        setFieldErrors({
          username: error.fieldErrors.username?.[0],
          password: error.fieldErrors.password?.[0],
        })
      }
      setFormError(loginErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-layout">
      {/* Logotipo institucional: parte del layout de la página, fuera de la tarjeta. */}
      <header className="auth-layout__brand" data-testid="login-brand">
        <InstitutionLogo variant="on-white" />
      </header>

      <main className="auth-page" id="contenido">
        <section className="auth-card" aria-labelledby="login-title">
          <header className="auth-card__header">
            <p className="auth-card__brand">SGIM-CMCH</p>
            <h1 id="login-title" className="auth-card__title">
              Iniciar sesión
            </h1>
            <p className="auth-card__subtitle">
              Sistema de Gestión de Incidencias y Mantenimiento
            </p>
          </header>

          {notice && (
            <Alert tone={notice.tone} title={notice.title} live="polite">
              {notice.text}
            </Alert>
          )}

          {formError && (
            <Alert ref={errorRef} tone="danger" live="assertive" id="login-error">
              {formError}
              {throttled && (
                <span className="alert__countdown">
                  {' '}
                  Podrás intentarlo de nuevo en {secondsLeft} s.
                </span>
              )}
            </Alert>
          )}

          <form
            className="auth-form"
            onSubmit={handleSubmit}
            noValidate
            aria-describedby={formError ? 'login-error' : undefined}
          >
            <TextField
              ref={usernameRef}
              label="Usuario"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={150}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              error={fieldErrors.username}
            />
            <PasswordField
              ref={passwordRef}
              label="Contraseña"
              name="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
            />
            <Button
              type="submit"
              fullWidth
              loading={submitting}
              loadingText="Ingresando…"
              disabled={throttled}
            >
              Ingresar
            </Button>
          </form>
        </section>
      </main>
    </div>
  )
}
