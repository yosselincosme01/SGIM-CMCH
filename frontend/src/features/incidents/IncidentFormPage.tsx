import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import { SelectField } from '../../shared/ui/SelectField'
import { TextAreaField } from '../../shared/ui/TextAreaField'
import {
  createIncident,
  fetchIncidentOptions,
  type IncidentDetail,
  type IncidentOptions,
  type NewIncident,
} from './api'
import { EQUIPMENT_QR_OPTIONS, type EquipmentQrStatus } from './equipment'
import { IncidentBreadcrumb } from './IncidentBreadcrumb'
import { QrCodeInput } from './QrCodeInput'
import { SUPPORT_AREA_HINTS } from './supportAreas'
import {
  DESCRIPTION_MAX,
  type IncidentFormErrors,
  PHOTO_TYPES,
  PRIOR_ACTIONS_MAX,
  SERVER_FIELD_MAP,
  formatBytes,
  validateIncident,
  validatePhoto,
} from './validation'

const EMPTY: NewIncident = {
  careUnit: '',
  supportArea: '',
  description: '',
  priorActions: '',
  equipmentQrStatus: '',
  qrCode: '',
  photo: null,
}

const FIELD_ORDER: (keyof IncidentFormErrors)[] = [
  'careUnit',
  'equipmentQrStatus',
  'qrCode',
  'supportArea',
  'description',
  'priorActions',
  'photo',
]

export function IncidentFormPage() {
  useDocumentTitle('Registrar incidencia')
  const [options, setOptions] = useState<IncidentOptions | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [form, setForm] = useState<NewIncident>(EMPTY)
  const [errors, setErrors] = useState<IncidentFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<IncidentDetail | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const confirmationRef = useRef<HTMLHeadingElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchIncidentOptions(controller.signal)
      .then((data) => {
        setOptions(data)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(isApiError(error) ? error.message : 'No se pudieron cargar las opciones.')
      })
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    if (created) confirmationRef.current?.focus()
  }, [created])

  useEffect(() => {
    if (formError) errorRef.current?.focus()
  }, [formError])

  function update<K extends keyof NewIncident>(key: K, value: NewIncident[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  function selectEquipment(status: EquipmentQrStatus) {
    // Al cambiar de opción se descarta el código: nunca se envían datos ocultos.
    setForm((current) => ({
      ...current,
      equipmentQrStatus: status,
      qrCode: status === 'qr_readable' ? current.qrCode : '',
    }))
    setErrors((current) => ({ ...current, equipmentQrStatus: undefined, qrCode: undefined }))
  }

  function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    const error = validatePhoto(file)
    if (error) {
      event.target.value = ''
      setForm((current) => ({ ...current, photo: null }))
      setErrors((current) => ({ ...current, photo: error }))
      return
    }
    update('photo', file)
  }

  function clearPhoto() {
    update('photo', null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function focusFirstError(found: IncidentFormErrors) {
    const first = FIELD_ORDER.find((field) => found[field])
    if (!first) return
    const target = formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)
    const focusable = target?.matches('input, select, textarea')
      ? target
      : target?.querySelector<HTMLElement>('input, select, textarea')
    focusable?.focus()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    const found = validateIncident(form)
    setErrors(found)
    setFormError(null)
    if (Object.values(found).some(Boolean)) {
      focusFirstError(found)
      return
    }

    setSubmitting(true)
    try {
      setCreated(await createIncident(form))
    } catch (error) {
      if (isApiError(error) && error.kind === 'validation') {
        const mapped: IncidentFormErrors = {}
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const key = SERVER_FIELD_MAP[field]
          if (key) mapped[key] = messages[0]
        }
        setErrors(mapped)
        setFormError('Revisa los campos marcados.')
        focusFirstError(mapped)
      } else if (isApiError(error) && error.kind === 'forbidden') {
        setFormError(
          error.isCsrfFailure
            ? 'No se pudo verificar la seguridad de la solicitud. Recarga la página e inténtalo de nuevo.'
            : 'Tu cuenta no tiene permiso para registrar incidencias.',
        )
      } else if (isApiError(error) && (error.kind === 'network' || error.kind === 'timeout')) {
        setFormError('No se pudo conectar con el servidor. Tu incidencia no se registró; inténtalo de nuevo.')
      } else {
        setFormError('No se pudo registrar la incidencia. Inténtalo de nuevo.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function startAnother() {
    setCreated(null)
    setForm(EMPTY)
    setErrors({})
    setFormError(null)
  }

  if (created) {
    return (
      <div className="stack">
        <IncidentBreadcrumb current="Registrar incidencia" />
        <section className="confirmation" aria-labelledby="confirmation-title">
          <p className="confirmation__eyebrow">Incidencia registrada</p>
          <h1 id="confirmation-title" className="confirmation__title" tabIndex={-1} ref={confirmationRef}>
            Tu incidencia se registró correctamente
          </h1>
          <p className="confirmation__label">Código de seguimiento</p>
          <p className="confirmation__code" data-testid="incident-code">
            {created.code}
          </p>
          <p className="confirmation__text">
            Se envió al área de <strong>{created.support_area.name}</strong> para{' '}
            <strong>{created.care_unit.name}</strong>. Guarda el código para hacer seguimiento.
          </p>
          <div className="actions">
            <Link to={`/solicitante/incidencias/${created.code}`} className="btn btn--primary">
              Ver detalle
            </Link>
            <Link to="/solicitante/incidencias" className="btn btn--secondary">
              Mis incidencias
            </Link>
            <Button variant="ghost" onClick={startAnother}>
              Registrar otra
            </Button>
          </div>
        </section>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="stack">
        <IncidentBreadcrumb current="Registrar incidencia" />
        <Alert tone="danger" title="No se pudo cargar el formulario" live="assertive">
          {loadError}
        </Alert>
        <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
      </div>
    )
  }

  if (!options) return <LoadingState label="Cargando formulario…" />

  const hasDemoUnits = options.care_units.some((unit) => unit.is_demo)

  return (
    <div className="stack">
      <IncidentBreadcrumb current="Registrar incidencia" />
      <header className="page__header">
        <p className="page__eyebrow">Solicitante</p>
        <h1 className="page__title">Registrar incidencia</h1>
        <p className="page__lead">
          Describe lo que observas. No necesitas indicar la causa técnica: el área de soporte
          hará la evaluación.
        </p>
      </header>

      {hasDemoUnits && (
        <Alert tone="info" title="Catálogo de demostración">
          Las UPS marcadas con [DEMO] son ficticias y se reemplazarán por el catálogo autorizado.
        </Alert>
      )}

      {formError && (
        <Alert ref={errorRef} tone="danger" live="assertive" id="incident-form-error">
          {formError}
        </Alert>
      )}

      <form
        ref={formRef}
        className="form-card"
        onSubmit={handleSubmit}
        noValidate
        aria-describedby={formError ? 'incident-form-error' : undefined}
      >
        <fieldset className="form-section">
          <legend className="form-section__title">¿Dónde ocurre?</legend>
          <div data-field="careUnit">
            <SelectField
              label="UPS o servicio"
              required
              placeholder="Selecciona una UPS o servicio"
              value={form.careUnit}
              onChange={(event) => update('careUnit', event.target.value)}
              options={options.care_units.map((unit) => ({ value: unit.code, label: unit.name }))}
              error={errors.careUnit}
            />
          </div>
        </fieldset>

        <fieldset
          className="form-section"
          data-field="equipmentQrStatus"
          aria-describedby={errors.equipmentQrStatus ? 'equipment-error' : undefined}
          aria-invalid={errors.equipmentQrStatus ? true : undefined}
        >
          <legend className="form-section__title">
            Identificación del equipo <span className="field__required" aria-hidden="true">*</span>
          </legend>
          <p className="field__label" id="equipment-question">
            ¿El equipo tiene código QR?
          </p>
          <div
            className="choice-grid"
            role="radiogroup"
            aria-required="true"
            aria-labelledby="equipment-question"
          >
            {EQUIPMENT_QR_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`choice ${form.equipmentQrStatus === option.value ? 'choice--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="equipment_qr_status"
                  value={option.value}
                  checked={form.equipmentQrStatus === option.value}
                  onChange={() => selectEquipment(option.value)}
                />
                <span className="choice__title">{option.label}</span>
                <span className="choice__hint">{option.hint}</span>
              </label>
            ))}
          </div>
          {errors.equipmentQrStatus && (
            <p id="equipment-error" className="field__error">
              {errors.equipmentQrStatus}
            </p>
          )}
          {form.equipmentQrStatus === 'qr_readable' && (
            <div data-field="qrCode">
              <QrCodeInput
                value={form.qrCode}
                onCode={(value) => update('qrCode', value)}
                error={errors.qrCode}
              />
            </div>
          )}
        </fieldset>

        <fieldset
          className="form-section"
          data-field="supportArea"
          aria-describedby={errors.supportArea ? 'support-area-error' : undefined}
          aria-invalid={errors.supportArea ? true : undefined}
        >
          <legend className="form-section__title">
            Área de soporte <span className="field__required" aria-hidden="true">*</span>
          </legend>
          <div className="choice-grid" role="radiogroup" aria-required="true">
            {options.support_areas.map((area) => (
              <label
                key={area.code}
                className={`choice ${form.supportArea === area.code ? 'choice--selected' : ''}`}
              >
                <input
                  type="radio"
                  name="support_area"
                  value={area.code}
                  checked={form.supportArea === area.code}
                  onChange={() => update('supportArea', area.code)}
                />
                <span className="choice__title">{area.name}</span>
                {SUPPORT_AREA_HINTS[area.code] && (
                  <span className="choice__hint">{SUPPORT_AREA_HINTS[area.code]}</span>
                )}
              </label>
            ))}
          </div>
          {errors.supportArea && (
            <p id="support-area-error" className="field__error">
              {errors.supportArea}
            </p>
          )}
        </fieldset>

        <fieldset className="form-section">
          <legend className="form-section__title">¿Qué ocurre?</legend>
          <div data-field="description">
            <TextAreaField
              label="Descripción del problema"
              required
              rows={5}
              maxLength={DESCRIPTION_MAX}
              hint="Qué observas, desde cuándo y cómo afecta a la atención."
              value={form.description}
              onChange={(event) => update('description', event.target.value)}
              error={errors.description}
            />
          </div>
          <div data-field="priorActions">
            <TextAreaField
              label="Acciones realizadas antes de reportar"
              rows={3}
              maxLength={PRIOR_ACTIONS_MAX}
              hint="Por ejemplo: se reinició el equipo o se revisó la conexión."
              value={form.priorActions}
              onChange={(event) => update('priorActions', event.target.value)}
              error={errors.priorActions}
            />
          </div>
        </fieldset>

        <fieldset className="form-section" data-field="photo">
          <legend className="form-section__title">Evidencia (opcional)</legend>
          <div className={['field', errors.photo && 'field--invalid'].filter(Boolean).join(' ')}>
            <label className="field__label" htmlFor="incident-photo">
              Fotografía
            </label>
            <p className="field__hint" id="incident-photo-hint">
              JPG, PNG o WebP, hasta 5 MB. No incluyas rostros ni datos de pacientes.
            </p>
            <input
              ref={fileInputRef}
              id="incident-photo"
              type="file"
              accept={PHOTO_TYPES.join(',')}
              className="file-input"
              onChange={handlePhoto}
              aria-invalid={errors.photo ? true : undefined}
              aria-describedby={['incident-photo-hint', errors.photo && 'incident-photo-error']
                .filter(Boolean)
                .join(' ')}
            />
            {form.photo && (
              <div className="file-selected">
                <span>
                  {form.photo.name} · {formatBytes(form.photo.size)}
                </span>
                <Button variant="ghost" onClick={clearPhoto}>
                  Quitar
                </Button>
              </div>
            )}
            {errors.photo && (
              <p id="incident-photo-error" className="field__error">
                {errors.photo}
              </p>
            )}
          </div>
        </fieldset>

        <div className="form-actions">
          <Link to="/solicitante" className="btn btn--ghost">
            Cancelar
          </Link>
          <Button type="submit" loading={submitting} loadingText="Registrando…">
            Registrar incidencia
          </Button>
        </div>
      </form>
    </div>
  )
}
