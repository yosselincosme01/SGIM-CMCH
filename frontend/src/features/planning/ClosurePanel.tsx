import { type FormEvent, useState } from 'react'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/dates'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { TextAreaField } from '../../shared/ui/TextAreaField'
import { reopenIncident, verifyClosure } from '../attention/api'
import type { IncidentDetail } from '../incidents/api'

const REASON_MIN = 10
const TEXT_MAX = 2000

interface ClosurePanelProps {
  incident: IncidentDetail
  onSaved: (incident: IncidentDetail) => void
  onReload: () => void
}

/**
 * Cierre técnico vigente: verificación (Conforme / No conforme) y, tras una
 * verificación No conforme, reapertura con motivo. El backend vuelve a comprobar que
 * quien actúa sea Planificador del área y que la transición sea válida.
 */
export function ClosurePanel({ incident, onSaved, onReload }: ClosurePanelProps) {
  const closure = incident.closure
  const permissions = incident.permissions
  const [result, setResult] = useState<'conforming' | 'not_conforming' | ''>('')
  const [observations, setObservations] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  if (!closure) return null

  function handleError(error: unknown) {
    if (isApiError(error) && error.status === 409) {
      setErrors({ form: 'La incidencia cambió mientras la revisabas. Se cargaron los datos actuales.' })
      onReload()
    } else if (isApiError(error) && error.kind === 'validation') {
      const mapped: Record<string, string> = {}
      for (const [key, messages] of Object.entries(error.fieldErrors)) mapped[key] = messages[0]
      setErrors(Object.keys(mapped).length ? mapped : { form: error.message })
    } else if (isApiError(error) && error.kind === 'forbidden') {
      setErrors({ form: 'No eres Planificador del área de esta incidencia.' })
    } else {
      setErrors({ form: isApiError(error) ? error.message : 'No se pudo guardar.' })
    }
  }

  async function submitVerification(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (!result) found.result = 'Selecciona Conforme o No conforme.'
    if (result === 'not_conforming' && !observations.trim())
      found.observations = 'Describe por qué la atención no es conforme.'
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      onSaved(await verifyClosure(incident.code, result, observations))
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  async function submitReopen(event: FormEvent) {
    event.preventDefault()
    if (reason.trim().length < REASON_MIN) {
      setErrors({ reason: `Indica el motivo de la reapertura (al menos ${REASON_MIN} caracteres).` })
      return
    }
    setErrors({})
    setSaving(true)
    try {
      onSaved(await reopenIncident(incident.code, reason))
    } catch (error) {
      handleError(error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="planning-panel" aria-labelledby="closure-title">
      <h2 id="closure-title" className="planning-panel__title">
        Cierre técnico
      </h2>
      <dl className="current-assignment">
        <div>
          <dt>Cerrada por</dt>
          <dd>{closure.closed_by.full_name}</dd>
        </div>
        <div>
          <dt>Fecha de cierre</dt>
          <dd>{formatDateTime(closure.closed_at)} (hora de Lima)</dd>
        </div>
        <div>
          <dt>Verificación</dt>
          <dd>
            {closure.verification
              ? `${closure.verification.result_label} · ${closure.verification.verified_by.full_name} · ${formatDateTime(closure.verification.created_at)}`
              : 'Pendiente de verificación'}
          </dd>
        </div>
        {closure.verification?.observations && (
          <div>
            <dt>Observaciones de la verificación</dt>
            <dd className="preserve-lines">{closure.verification.observations}</dd>
          </div>
        )}
      </dl>

      {errors.form && (
        <Alert tone="danger" live="assertive">
          {errors.form}
        </Alert>
      )}

      {permissions?.can_verify && (
        <form className="stack" noValidate onSubmit={submitVerification}>
          <fieldset className="form-section">
            <legend className="field__label">
              Resultado de la verificación <span className="field__required" aria-hidden="true">*</span>
            </legend>
            <div className="yes-no__options">
              {[
                { value: 'conforming' as const, label: 'Conforme' },
                { value: 'not_conforming' as const, label: 'No conforme' },
              ].map((option) => (
                <label
                  key={option.value}
                  className={`reason-option${result === option.value ? ' reason-option--selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="verification_result"
                    checked={result === option.value}
                    onChange={() => {
                      setResult(option.value)
                      setErrors({})
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            {errors.result && <p className="field__error">{errors.result}</p>}
          </fieldset>
          <TextAreaField
            label="Observaciones"
            required={result === 'not_conforming'}
            hint={result === 'not_conforming' ? 'Obligatorias si la atención no es conforme.' : undefined}
            rows={3}
            maxLength={TEXT_MAX}
            value={observations}
            onChange={(event) => setObservations(event.target.value)}
            error={errors.observations}
          />
          <Button type="submit" loading={saving} loadingText="Guardando…" fullWidth>
            Registrar verificación
          </Button>
        </form>
      )}

      {permissions?.can_reopen && (
        <form className="stack" noValidate onSubmit={submitReopen}>
          <p className="field__hint">
            La atención no fue conforme. Puedes reabrir la incidencia para programar una nueva
            atención; el cierre y la verificación anteriores se conservan en el historial.
          </p>
          <TextAreaField
            label="Motivo de la reapertura"
            required
            rows={3}
            maxLength={TEXT_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={errors.reason}
          />
          <Button type="submit" variant="danger" loading={saving} loadingText="Reabriendo…" fullWidth>
            Reabrir incidencia
          </Button>
        </form>
      )}

      {!permissions?.can_verify && !permissions?.can_reopen && (
        <p className="muted">
          {closure.verification
            ? 'La verificación de este cierre ya está registrada.'
            : 'Solo el Planificador del área puede verificar este cierre.'}
        </p>
      )}
    </section>
  )
}
