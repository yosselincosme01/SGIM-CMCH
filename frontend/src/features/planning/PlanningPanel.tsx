import { type FormEvent, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { isApiError } from '../../shared/api/errors'
import {
  formatDateTime,
  isPastLimaInput,
  isValidLocalInput,
  toLimaInputValue,
} from '../../shared/dates'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { TextAreaField } from '../../shared/ui/TextAreaField'
import type { IncidentDetail, PriorityLevel } from '../incidents/api'
import { scheduleAttention, setPriority, type Technician } from './api'
import { ProvisionalPriorityNote } from './PlanningParts'

export const REASON_MIN = 10
export const REASON_MAX = 500
export const NOTES_MAX = 1000

type Field = 'priority' | 'technician' | 'scheduledAt' | 'notes' | 'reason'
type Errors = Partial<Record<Field | 'form', string>>

const SERVER_FIELDS: Record<string, Field | 'form'> = {
  priority: 'priority',
  technician: 'technician',
  scheduled_at: 'scheduledAt',
  notes: 'notes',
  reason: 'reason',
  non_field_errors: 'form',
}

interface Values {
  priority: string
  technician: string
  scheduledAt: string
  notes: string
  reason: string
}

function initialValues(incident: IncidentDetail): Values {
  const assignment = incident.assignment
  return {
    priority: incident.priority?.code ?? '',
    technician: assignment?.technician.username ?? '',
    scheduledAt: assignment ? toLimaInputValue(assignment.scheduled_at) : '',
    notes: assignment?.notes ?? '',
    reason: '',
  }
}

interface PlanningPanelProps {
  incident: IncidentDetail
  priorities: PriorityLevel[]
  technicians: Technician[]
  onSaved: (incident: IncidentDetail) => void
  onReload: () => Promise<IncidentDetail>
  /** Marca el resto de la página como inerte mientras hay un diálogo abierto. */
  onDialogChange: (open: boolean) => void
}

/**
 * Panel de prioridad y programación. Valida en el navegador para orientar al
 * usuario, pero el backend repite todas las comprobaciones de permisos y datos.
 */
export function PlanningPanel({
  incident,
  priorities,
  technicians,
  onSaved,
  onReload,
  onDialogChange,
}: PlanningPanelProps) {
  const [values, setValues] = useState<Values>(() => initialValues(incident))
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState<'priority' | 'schedule' | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning'; text: string } | null>(
    null,
  )
  const [confirming, setConfirming] = useState(false)
  const noticeRef = useRef<HTMLDivElement>(null)

  const assignment = incident.assignment ?? null
  const isReplan = assignment !== null
  const canPlan = incident.permissions?.can_plan === true

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  useEffect(() => onDialogChange(confirming), [confirming, onDialogChange])

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }))
  }

  if (!canPlan) {
    return (
      <section className="planning-panel" aria-labelledby="planning-title">
        <h2 id="planning-title" className="planning-panel__title">
          Planificación
        </h2>
        <CurrentAssignment incident={incident} />
        <p className="muted">No puedes planificar esta incidencia en su estado actual.</p>
      </section>
    )
  }

  const technicianChanged = isReplan && values.technician !== assignment.technician.username
  const scheduleChanged = isReplan && values.scheduledAt !== toLimaInputValue(assignment.scheduled_at)

  function validateSchedule(): Errors {
    const next: Errors = {}
    if (!values.priority) next.priority = 'Selecciona la prioridad.'
    if (!values.technician) next.technician = 'Selecciona el técnico responsable.'
    if (!values.scheduledAt) next.scheduledAt = 'Indica la fecha y hora estimada de atención.'
    else if (!isValidLocalInput(values.scheduledAt))
      next.scheduledAt = 'Indica una fecha y hora válidas.'
    else if ((!isReplan || scheduleChanged) && isPastLimaInput(values.scheduledAt))
      next.scheduledAt = 'La fecha y hora de atención no puede estar en el pasado.'
    if (values.notes.trim().length > NOTES_MAX)
      next.notes = `Las indicaciones no pueden superar ${NOTES_MAX} caracteres.`
    if (isReplan) {
      if (!technicianChanged && !scheduleChanged)
        next.form = 'Cambia el técnico responsable o la fecha para reprogramar.'
      if (values.reason.trim().length < REASON_MIN)
        next.reason = `Indica el motivo del cambio (al menos ${REASON_MIN} caracteres).`
    }
    if (values.reason.trim().length > REASON_MAX)
      next.reason = `El motivo no puede superar ${REASON_MAX} caracteres.`
    return next
  }

  function handleError(error: unknown) {
    if (isApiError(error) && error.status === 409) {
      setNotice({
        tone: 'warning',
        text: 'Otra persona actualizó esta incidencia. Se cargaron los datos actuales; revisa y vuelve a guardar.',
      })
      void onReload()
      return
    }
    if (isApiError(error) && error.kind === 'validation') {
      const next: Errors = {}
      for (const [key, messages] of Object.entries(error.fieldErrors)) {
        next[SERVER_FIELDS[key] ?? 'form'] = messages[0]
      }
      if (Object.keys(next).length === 0) next.form = error.message
      setErrors(next)
      return
    }
    setErrors({
      form: isApiError(error) ? error.message : 'No se pudo guardar. Inténtalo nuevamente.',
    })
  }

  async function savePriority() {
    setNotice(null)
    if (!values.priority) {
      setErrors({ priority: 'Selecciona la prioridad.' })
      return
    }
    if (values.priority === incident.priority?.code) {
      setErrors({ priority: 'La incidencia ya tiene esa prioridad.' })
      return
    }
    setSaving('priority')
    try {
      const updated = await setPriority(incident.code, values.priority, values.reason)
      onSaved(updated)
      setValues((current) => ({ ...current, reason: '' }))
      setNotice({ tone: 'success', text: 'Prioridad actualizada y registrada en el historial.' })
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(null)
    }
  }

  async function saveSchedule() {
    setConfirming(false)
    setSaving('schedule')
    try {
      const updated = await scheduleAttention(incident.code, {
        ...values,
        expectedAssignment: assignment?.id ?? null,
      })
      onSaved(updated)
      setValues(initialValues(updated))
      setNotice({
        tone: 'success',
        text: isReplan
          ? 'Reprogramación guardada y registrada en el historial.'
          : 'Atención programada. La incidencia quedó asignada.',
      })
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(null)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    setNotice(null)
    const next = validateSchedule()
    setErrors(next)
    if (Object.values(next).some(Boolean)) return
    if (isReplan) setConfirming(true)
    else void saveSchedule()
  }

  const selectedTechnician = technicians.find((person) => person.username === values.technician)
  const noTechnicians = technicians.length === 0

  return (
    <section className="planning-panel" aria-labelledby="planning-title">
      <h2 id="planning-title" className="planning-panel__title">
        {isReplan ? 'Reprogramar atención' : 'Programar atención'}
      </h2>

      {notice && (
        <div ref={noticeRef} tabIndex={-1} className="planning-panel__notice">
          <Alert tone={notice.tone} live="polite">
            {notice.text}
          </Alert>
        </div>
      )}
      <CurrentAssignment incident={incident} />

      <form className="stack planning-form" noValidate onSubmit={submit}>
        {errors.form && (
          <Alert tone="danger" live="assertive">
            {errors.form}
          </Alert>
        )}

        <fieldset className="form-section">
          <legend className="form-section__title">
            Prioridad{' '}
            <span className="field__required" aria-hidden="true">
              *
            </span>
          </legend>
          <ProvisionalPriorityNote />
          <div className="choice-grid choice-grid--compact">
            {priorities.map((level) => (
              <label
                key={level.code}
                className={`choice${values.priority === level.code ? ' choice--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="priority"
                  value={level.code}
                  checked={values.priority === level.code}
                  onChange={() => set('priority', level.code)}
                />
                <span className="choice__title">{level.name}</span>
                {level.description && <span className="choice__hint">{level.description}</span>}
              </label>
            ))}
          </div>
          {errors.priority && <p className="field__error">{errors.priority}</p>}
          <Button
            variant="secondary"
            onClick={savePriority}
            loading={saving === 'priority'}
            loadingText="Guardando…"
            disabled={saving !== null}
          >
            Guardar solo prioridad
          </Button>
        </fieldset>

        <fieldset className="form-section">
          <legend className="form-section__title">Técnico y fecha</legend>
          {noTechnicians ? (
            <Alert tone="warning" title="No hay técnicos autorizados en esta área">
              Solicita al administrador que habilite a personal de atención en el área de{' '}
              {incident.support_area.name}.
            </Alert>
          ) : (
            <div className={`field${errors.technician ? ' field--invalid' : ''}`}>
              <label className="field__label" htmlFor="planning-technician">
                Técnico responsable{' '}
                <span className="field__required" aria-hidden="true">
                  *
                </span>
              </label>
              <p id="planning-technician-hint" className="field__hint">
                Solo se muestran técnicos autorizados del área de {incident.support_area.name}.
              </p>
              <select
                id="planning-technician"
                className="field__input field__select"
                value={values.technician}
                required
                aria-required
                aria-invalid={errors.technician ? true : undefined}
                aria-describedby={
                  errors.technician
                    ? 'planning-technician-hint planning-technician-error'
                    : 'planning-technician-hint'
                }
                onChange={(event) => set('technician', event.target.value)}
              >
                <option value="">Selecciona un técnico</option>
                {technicians.map((person) => (
                  <option key={person.username} value={person.username}>
                    {person.full_name} · {person.active_assignments}{' '}
                    {person.active_assignments === 1 ? 'asignación vigente' : 'asignaciones vigentes'}
                  </option>
                ))}
              </select>
              {selectedTechnician?.next_scheduled_at && (
                <p className="field__hint">
                  Próxima atención programada:{' '}
                  {formatDateTime(selectedTechnician.next_scheduled_at)}
                </p>
              )}
              {errors.technician && (
                <p id="planning-technician-error" className="field__error">
                  {errors.technician}
                </p>
              )}
            </div>
          )}

          <div className={`field${errors.scheduledAt ? ' field--invalid' : ''}`}>
            <label className="field__label" htmlFor="planning-date">
              Fecha y hora estimada de atención{' '}
              <span className="field__required" aria-hidden="true">
                *
              </span>
            </label>
            <p id="planning-date-hint" className="field__hint">
              Hora de Lima.
            </p>
            <input
              id="planning-date"
              type="datetime-local"
              className="field__input"
              value={values.scheduledAt}
              min={toLimaInputValue(new Date())}
              required
              aria-required
              aria-invalid={errors.scheduledAt ? true : undefined}
              aria-describedby={
                errors.scheduledAt ? 'planning-date-hint planning-date-error' : 'planning-date-hint'
              }
              onChange={(event) => set('scheduledAt', event.target.value)}
            />
            {errors.scheduledAt && (
              <p id="planning-date-error" className="field__error">
                {errors.scheduledAt}
              </p>
            )}
          </div>

          <TextAreaField
            label="Indicaciones internas"
            hint="Solo las ve el personal del área. El solicitante no las ve."
            value={values.notes}
            maxLength={NOTES_MAX}
            error={errors.notes}
            onChange={(event) => set('notes', event.target.value)}
          />

          {(isReplan || incident.priority) && (
          <TextAreaField
            label={isReplan ? 'Motivo de la reprogramación o reasignación' : 'Motivo del cambio de prioridad'}
            hint={
              isReplan
                ? 'Obligatorio: queda registrado en el historial junto con los valores anteriores y nuevos.'
                : 'Opcional. Se registra en el historial si cambias la prioridad.'
            }
            required={isReplan}
            value={values.reason}
            maxLength={REASON_MAX}
            error={errors.reason}
            onChange={(event) => set('reason', event.target.value)}
          />
          )}
        </fieldset>

        <div className="form-actions">
          <Button
            type="submit"
            loading={saving === 'schedule'}
            loadingText="Guardando…"
            disabled={saving !== null || noTechnicians}
            fullWidth
          >
            {isReplan ? 'Guardar reprogramación' : 'Programar atención'}
          </Button>
        </div>
      </form>

      {confirming &&
        assignment &&
        createPortal(
          <Dialog
            title="Confirmar reprogramación"
            role="dialog"
            actions={
              <>
                <Button variant="secondary" onClick={() => setConfirming(false)}>
                  Volver
                </Button>
                <Button onClick={() => void saveSchedule()}>Confirmar cambios</Button>
              </>
            }
          >
            <dl className="change-summary">
              {technicianChanged && (
                <div>
                  <dt>Técnico responsable</dt>
                  <dd>
                    {assignment.technician.full_name} → {selectedTechnician?.full_name ?? values.technician}
                  </dd>
                </div>
              )}
              {scheduleChanged && (
                <div>
                  <dt>Fecha estimada</dt>
                  <dd>
                    {formatDateTime(assignment.scheduled_at)} →{' '}
                    {values.scheduledAt.replace('T', ' ')} (hora de Lima)
                  </dd>
                </div>
              )}
              <div>
                <dt>Motivo</dt>
                <dd className="preserve-lines">{values.reason.trim()}</dd>
              </div>
            </dl>
          </Dialog>,
          document.body,
        )}
    </section>
  )
}

function CurrentAssignment({ incident }: { incident: IncidentDetail }) {
  const assignment = incident.assignment
  if (!assignment) return <p className="muted">Todavía no tiene técnico ni fecha programada.</p>
  return (
    <dl className="current-assignment">
      <div>
        <dt>Técnico responsable</dt>
        <dd>{assignment.technician.full_name}</dd>
      </div>
      <div>
        <dt>Fecha estimada</dt>
        <dd>{formatDateTime(assignment.scheduled_at)} (hora de Lima)</dd>
      </div>
      <div>
        <dt>Programada por</dt>
        <dd>{assignment.assigned_by.full_name}</dd>
      </div>
    </dl>
  )
}
