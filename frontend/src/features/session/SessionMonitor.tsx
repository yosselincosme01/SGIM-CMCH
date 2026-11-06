/**
 * Monitor de la política de sesión (8 h absolutas, 30 min de inactividad).
 *
 * - Consulta GET /auth/session/ con peticiones PASIVAS: el polling nunca prolonga
 *   la sesión. Solo "Seguir conectado" hace una petición activa.
 * - El backend es la autoridad: cuando la cuenta local llega a cero, se vuelve a
 *   consultar al servidor. Si responde 401, el cliente de API cierra la sesión local
 *   y el contenido protegido se desmonta.
 * - Protección visual para equipos compartidos: mientras se muestra el aviso, el
 *   contenido queda difuminado e inerte; al expirar, desaparece de la pantalla.
 *
 * Ver docs/sesiones.md.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { activityEvents } from '../../shared/api/events'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { fetchCurrentUser, fetchSessionStatus } from '../auth/api'
import { useAuth } from '../auth/useAuth'
import { formatCountdown, useSessionSettings } from './sessionSettings'

type LimitKind = 'idle' | 'absolute'

interface Snapshot {
  /** Instante local (ms) en que vence la sesión, según `expires_in` del servidor. */
  deadline: number
  kind: LimitKind
}

export function SessionMonitor({ children }: { children: ReactNode }) {
  const settings = useSessionSettings()
  const { logout } = useAuth()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [dismissedDeadline, setDismissedDeadline] = useState<number | null>(null)
  const [continuing, setContinuing] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const checking = useRef(false)
  const lastCheck = useRef(0)

  const refresh = useCallback(async () => {
    if (checking.current) return
    checking.current = true
    lastCheck.current = Date.now()
    try {
      const status = await fetchSessionStatus()
      // Se usa expires_in (relativo) para no depender del reloj del equipo.
      setSnapshot({
        deadline: Date.now() + status.expires_in * 1000,
        kind: status.expires_at === status.absolute_expires_at ? 'absolute' : 'idle',
      })
      setNow(Date.now())
    } catch {
      // 401: el cliente de API ya notificó el cierre de sesión.
      // Error de red: se conserva la última información conocida.
    } finally {
      checking.current = false
    }
  }, [])

  // Consulta inicial, periódica y al volver a la pestaña.
  useEffect(() => {
    const initial = setTimeout(() => void refresh(), 0)
    const poll = setInterval(() => void refresh(), settings.pollIntervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(initial)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, settings.pollIntervalMs])

  // Tras una acción del usuario (petición activa), el servidor renovó la inactividad.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = activityEvents.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), settings.activityDebounceMs)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [refresh, settings.activityDebounceMs])

  // Cuenta regresiva local.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), settings.tickMs)
    return () => clearInterval(tick)
  }, [settings.tickMs])

  const secondsLeft = snapshot ? Math.max(0, Math.ceil((snapshot.deadline - now) / 1000)) : null
  const reachedZero = secondsLeft === 0

  // Al llegar a cero, decide el servidor (nunca se da por vencida localmente).
  useEffect(() => {
    if (reachedZero && Date.now() - lastCheck.current >= settings.recheckMs) void refresh()
  }, [reachedZero, now, refresh, settings.recheckMs])

  const inWarning = secondsLeft !== null && secondsLeft <= settings.warningSeconds
  const dismissed = snapshot !== null && dismissedDeadline === snapshot.deadline && !reachedZero
  const showDialog = inWarning && !dismissed

  async function handleContinue() {
    setContinuing(true)
    try {
      await fetchCurrentUser({ passive: false }) // única petición que renueva la inactividad
      await refresh()
    } catch {
      // 401: la sesión ya expiró y el cliente cerró la sesión local.
    } finally {
      setContinuing(false)
    }
  }

  async function handleLogout() {
    setSigningOut(true)
    await logout()
  }

  return (
    <>
      <div
        className={showDialog ? 'session-protected session-protected--hidden' : 'session-protected'}
        inert={showDialog}
        aria-hidden={showDialog || undefined}
        data-testid="protected-content"
      >
        {children}
      </div>
      {showDialog && snapshot && secondsLeft !== null && (
        <SessionWarning
          kind={snapshot.kind}
          secondsLeft={secondsLeft}
          continuing={continuing}
          signingOut={signingOut}
          onContinue={handleContinue}
          onDismiss={() => setDismissedDeadline(snapshot.deadline)}
          onLogout={handleLogout}
        />
      )}
    </>
  )
}

interface SessionWarningProps {
  kind: LimitKind
  secondsLeft: number
  continuing: boolean
  signingOut: boolean
  onContinue: () => void
  onDismiss: () => void
  onLogout: () => void
}

function SessionWarning({
  kind,
  secondsLeft,
  continuing,
  signingOut,
  onContinue,
  onDismiss,
  onLogout,
}: SessionWarningProps) {
  const countdown = formatCountdown(secondsLeft)
  const verifying = secondsLeft === 0

  if (kind === 'absolute') {
    return (
      <Dialog
        title="Tu sesión llegará a su duración máxima"
        actions={
          <>
            <Button onClick={onDismiss} disabled={verifying}>
              Entendido
            </Button>
            <Button variant="secondary" onClick={onLogout} loading={signingOut}>
              Cerrar sesión ahora
            </Button>
          </>
        }
      >
        {verifying ? (
          <p>Verificando el estado de tu sesión…</p>
        ) : (
          <p>
            Por seguridad, la sesión se cerrará en{' '}
            <strong className="countdown">
              {countdown}
            </strong>{' '}
            y tendrás que iniciar sesión nuevamente. Guarda tu trabajo.
          </p>
        )}
      </Dialog>
    )
  }

  return (
    <Dialog
      title="Tu sesión está por expirar"
      actions={
        <>
          <Button
            onClick={onContinue}
            loading={continuing}
            loadingText="Verificando…"
            disabled={verifying}
          >
            Seguir conectado
          </Button>
          <Button variant="secondary" onClick={onLogout} loading={signingOut}>
            Cerrar sesión
          </Button>
        </>
      }
    >
      {verifying ? (
        <p>Verificando el estado de tu sesión…</p>
      ) : (
        <p>
          Por inactividad, tu sesión se cerrará en{' '}
          <strong className="countdown">
            {countdown}
          </strong>
          . La información en pantalla se ocultó por seguridad.
        </p>
      )}
    </Dialog>
  )
}
