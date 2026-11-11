import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router'

import { evaluateSurveyPath, PATHS } from '../../shared/paths'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { useCurrentUser } from '../auth/useAuth'
import { isOperational } from '../navigation/access'
import { fetchSurveyReminder, markSurveyReminderShown, type SurveyReminder as Reminder } from './surveyApi'

/**
 * Recordatorio de encuestas pendientes al iniciar sesión (ADR 0012).
 *
 * - Se consulta una vez al montar el área autenticada, con una petición pasiva.
 * - Solo aparece si el backend indica ``show``: hay cierres vigentes sin evaluar en
 *   incidencias propias y aún no se mostró en esta sesión. La marca vive en la sesión
 *   del servidor, así que recargar o navegar no lo repite, y no pasa a otra cuenta.
 * - Un solo modal, aunque haya varias encuestas. «Ahora no» no registra respuestas.
 * - No se consulta para cuentas sin rol operativo (por ejemplo, solo administrativas).
 */
export function SurveyReminder({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const user = useCurrentUser()
  const operational = isOperational(user)
  const navigate = useNavigate()
  const [reminder, setReminder] = useState<Reminder | null>(null)

  useEffect(() => {
    if (!operational) return
    const controller = new AbortController()
    fetchSurveyReminder(controller.signal)
      .then((data) => {
        if (controller.signal.aborted || !data.show) return
        setReminder(data)
        onOpenChange(true)
        // Se marca al mostrarse: una recarga no lo vuelve a abrir en esta sesión.
        markSurveyReminderShown().catch(() => {})
      })
      .catch(() => {
        // Sin recordatorio si no se pudo consultar: el acceso sigue en Inicio y Mis incidencias.
      })
    return () => controller.abort()
  }, [operational, onOpenChange])

  if (!reminder) return null

  function close() {
    setReminder(null)
    onOpenChange(false)
  }

  function go(path: string) {
    close()
    navigate(path)
  }

  const single = reminder.total === 1
  const [first] = reminder.items

  return createPortal(
    <Dialog
      title={single ? 'Encuesta de satisfacción pendiente' : 'Encuestas de satisfacción pendientes'}
      role="dialog"
      onEscape={close}
      actions={
        <>
          <Button variant="secondary" onClick={close}>
            Ahora no
          </Button>
          {single ? (
            <Button onClick={() => go(evaluateSurveyPath(first.code))}>Evaluar atención</Button>
          ) : (
            <Button onClick={() => go(PATHS.myIncidents)}>Ver mis incidencias</Button>
          )}
        </>
      }
    >
      {single ? (
        <p>
          Tu atención del ticket <strong>{first.code}</strong> fue finalizada. ¿Deseas evaluar el
          servicio recibido? Es voluntario y puedes hacerlo después.
        </p>
      ) : (
        <>
          <p>
            Tienes <strong>{reminder.total}</strong> atenciones finalizadas pendientes de evaluar. Es
            voluntario y puedes hacerlo después.
          </p>
          <ul className="reminder-list">
            {reminder.items.map((item) => (
              <li key={item.code}>
                <Link to={evaluateSurveyPath(item.code)} onClick={close} aria-label={`Evaluar atención del ticket ${item.code}`}>
                  {item.code}
                </Link>
              </li>
            ))}
          </ul>
          {reminder.total > reminder.items.length && (
            <p className="muted">
              Y {reminder.total - reminder.items.length} más en Mis incidencias.
            </p>
          )}
        </>
      )}
    </Dialog>,
    document.body,
  )
}
