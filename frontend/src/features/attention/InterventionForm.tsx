import { type ChangeEvent, type FormEvent, useRef, useState } from 'react'

import { isApiError } from '../../shared/api/errors'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { TextAreaField } from '../../shared/ui/TextAreaField'
import type { IncidentDetail } from '../incidents/api'
import { formatBytes, PHOTO_TYPES, validatePhoto } from '../incidents/validation'
import { registerIntervention } from './api'
import {
  EMPTY,
  type Errors,
  FIELD_ORDER,
  PHOTOS_MAX,
  RESULTS,
  SERVER_FIELDS,
  TEXT_MAX,
  validateIntervention,
  type Values,
} from './interventionValidation'

interface InterventionFormProps {
  incident: IncidentDetail
  onSaved: (incident: IncidentDetail) => void
  onConflict: () => void
}

/**
 * Formulario de intervención del técnico asignado. Valida para orientar; el backend
 * vuelve a exigir todas las reglas, incluidas la asignación vigente y el estado.
 */
export function InterventionForm({ incident, onSaved, onConflict }: InterventionFormProps) {
  const [values, setValues] = useState<Values>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const assignment = incident.assignment

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined, form: undefined }))
  }

  function focusFirst(found: Errors) {
    const first = FIELD_ORDER.find((field) => found[field])
    formRef.current
      ?.querySelector<HTMLElement>(`[data-field="${first}"] input, [data-field="${first}"] textarea`)
      ?.focus()
  }

  function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    for (const file of files) {
      const problem = validatePhoto(file)
      if (problem) {
        setErrors((current) => ({ ...current, photos: `${file.name}: ${problem}` }))
        return
      }
    }
    const next = [...values.photos, ...files]
    if (next.length > PHOTOS_MAX) {
      setErrors((current) => ({ ...current, photos: `Puedes adjuntar hasta ${PHOTOS_MAX} fotografías.` }))
      return
    }
    set('photos', next)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!assignment || saving) return
    const found = validateIntervention(values)
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      focusFirst(found)
      return
    }
    setSaving(true)
    try {
      const updated = await registerIntervention(incident.code, { ...values, assignment: assignment.id })
      setValues(EMPTY)
      onSaved(updated)
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        setErrors({ form: 'La incidencia cambió (por ejemplo, se reasignó). Se cargaron los datos actuales.' })
        onConflict()
      } else if (isApiError(error) && error.kind === 'validation') {
        const mapped: Errors = {}
        for (const [key, messages] of Object.entries(error.fieldErrors)) {
          mapped[SERVER_FIELDS[key] ?? 'form'] = messages[0]
        }
        setErrors(Object.keys(mapped).length ? mapped : { form: error.message })
        focusFirst(mapped)
      } else if (isApiError(error) && error.kind === 'forbidden') {
        setErrors({ form: 'Ya no eres el técnico asignado o no tienes permiso para esta incidencia.' })
      } else {
        setErrors({ form: isApiError(error) ? error.message : 'No se pudo registrar la intervención.' })
      }
    } finally {
      setSaving(false)
    }
  }

  const yesNo = (
    field: 'usedParts' | 'partsRequired',
    label: string,
    detailField: 'usedPartsDetail' | 'partsRequiredDetail',
    detailLabel: string,
  ) => (
    <fieldset className="form-section yes-no" data-field={field}>
      <legend className="field__label">
        {label} <span className="field__required" aria-hidden="true">*</span>
      </legend>
      <div className="yes-no__options">
        {[
          { value: true, text: 'Sí' },
          { value: false, text: 'No' },
        ].map((option) => (
          <label key={option.text} className={`reason-option${values[field] === option.value ? ' reason-option--selected' : ''}`}>
            <input
              type="radio"
              name={field}
              checked={values[field] === option.value}
              aria-invalid={errors[field] ? true : undefined}
              onChange={() => set(field, option.value)}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
      {errors[field] && <p className="field__error">{errors[field]}</p>}
      {values[field] && (
        <div data-field={detailField}>
          <TextAreaField
            label={detailLabel}
            required
            rows={2}
            maxLength={TEXT_MAX}
            value={values[detailField]}
            onChange={(event) => set(detailField, event.target.value)}
            error={errors[detailField]}
          />
        </div>
      )}
    </fieldset>
  )

  if (!assignment) return null

  return (
    <form ref={formRef} className="form-card intervention-form" onSubmit={submit} noValidate>
      <h2 className="form-section__title">Registrar intervención</h2>
      {errors.form && (
        <Alert tone="danger" live="assertive">
          {errors.form}
        </Alert>
      )}
      <div data-field="diagnosis">
        <TextAreaField
          label="Diagnóstico técnico"
          required
          rows={3}
          maxLength={TEXT_MAX}
          value={values.diagnosis}
          onChange={(event) => set('diagnosis', event.target.value)}
          error={errors.diagnosis}
        />
      </div>
      <div data-field="actionsTaken">
        <TextAreaField
          label="Acciones realizadas"
          required
          rows={3}
          maxLength={TEXT_MAX}
          value={values.actionsTaken}
          onChange={(event) => set('actionsTaken', event.target.value)}
          error={errors.actionsTaken}
        />
      </div>

      <fieldset className="form-section" data-field="result">
        <legend className="field__label">
          Resultado <span className="field__required" aria-hidden="true">*</span>
        </legend>
        <div className="choice-grid choice-grid--compact result-options">
          {RESULTS.map((option) => (
            <label key={option.value} className={`choice${values.result === option.value ? ' choice--selected' : ''}`}>
              <input
                type="radio"
                name="result"
                value={option.value}
                checked={values.result === option.value}
                onChange={() => set('result', option.value)}
              />
              <span className="choice__title">{option.label}</span>
              <span className="choice__hint">{option.hint}</span>
            </label>
          ))}
        </div>
        {errors.result && <p className="field__error">{errors.result}</p>}
      </fieldset>

      {values.result && values.result !== 'solved' && (
        <>
          <div data-field="unresolvedReason">
            <TextAreaField
              label="Motivo por el que no quedó solucionado"
              required
              rows={2}
              maxLength={TEXT_MAX}
              value={values.unresolvedReason}
              onChange={(event) => set('unresolvedReason', event.target.value)}
              error={errors.unresolvedReason}
            />
          </div>
        </>
      )}

      {yesNo('usedParts', '¿Se utilizaron repuestos?', 'usedPartsDetail', 'Repuestos utilizados')}
      {yesNo('partsRequired', '¿Se requieren repuestos?', 'partsRequiredDetail', 'Repuestos requeridos')}

      <TextAreaField
        label="Observaciones"
        rows={2}
        maxLength={TEXT_MAX}
        value={values.observations}
        onChange={(event) => set('observations', event.target.value)}
        error={errors.observations}
      />

      <fieldset className="form-section" data-field="photos">
        <legend className="field__label">
          Fotografías de evidencia <span className="field__required" aria-hidden="true">*</span>
        </legend>
        <p className="field__hint" id="intervention-photos-hint">
          Al menos una, hasta {PHOTOS_MAX}. JPG, PNG o WebP de hasta 5 MB. Se eliminan los
          metadatos de ubicación. No incluyas rostros ni datos de pacientes.
        </p>
        <label className="field__label visually-hidden" htmlFor="intervention-photos">
          Agregar fotografías
        </label>
        <input
          ref={fileRef}
          id="intervention-photos"
          type="file"
          multiple
          accept={PHOTO_TYPES.join(',')}
          className="file-input"
          aria-describedby="intervention-photos-hint"
          aria-invalid={errors.photos ? true : undefined}
          onChange={addPhotos}
        />
        {values.photos.length > 0 && (
          <ul className="photo-list">
            {values.photos.map((photo, index) => (
              <li key={`${photo.name}-${index}`} className="file-selected">
                <span>
                  {photo.name} · {formatBytes(photo.size)}
                </span>
                <Button
                  variant="ghost"
                  aria-label={`Quitar ${photo.name}`}
                  onClick={() => set('photos', values.photos.filter((_, i) => i !== index))}
                >
                  Quitar
                </Button>
              </li>
            ))}
          </ul>
        )}
        {errors.photos && <p className="field__error">{errors.photos}</p>}
      </fieldset>

      <div className="form-actions">
        <Button type="submit" loading={saving} loadingText="Registrando…" fullWidth>
          Registrar intervención
        </Button>
      </div>
    </form>
  )
}
