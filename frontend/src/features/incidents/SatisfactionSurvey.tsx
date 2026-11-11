import { type FormEvent, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { TextAreaField } from '../../shared/ui/TextAreaField'
import { formatDateTime } from './validation'
import { fetchSurvey, type SurveyAnswer, type SurveyState, submitSurvey } from './surveyApi'

const RATINGS = [1, 2, 3, 4, 5] as const
const RATING_LABELS: Record<number, string> = {
  1: 'Muy insatisfecho',
  2: 'Insatisfecho',
  3: 'Neutral',
  4: 'Satisfecho',
  5: 'Muy satisfecho',
}
const COMMENT_MAX = 1000

/** Calificación en estrellas, también en texto (no depende solo del dibujo). */
export function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="rating" aria-label={`${rating} de 5 estrellas`}>
      <span className="rating__stars" aria-hidden="true">
        {'★'.repeat(rating)}
        <span className="rating__empty">{'★'.repeat(5 - rating)}</span>
      </span>
      <span className="rating__text" aria-hidden="true">
        {rating}/5
      </span>
    </span>
  )
}

/** Lista de evaluaciones de solo lectura (solicitante, Responsable de Área, Administrador). */
export function SurveyHistory({
  surveys,
  title = 'Satisfacción del solicitante',
}: {
  surveys: SurveyAnswer[]
  title?: string
}) {
  if (surveys.length === 0) return null
  return (
    <section className="detail-card" aria-labelledby="survey-history">
      <h2 id="survey-history" className="detail-card__title">
        {title}
      </h2>
      <p className="field__hint">
        Opinión voluntaria del solicitante sobre cada cierre técnico. Es independiente de la
        verificación técnica del Responsable de Área.
      </p>
      <ul className="survey-list">
        {surveys.map((survey) => (
          <li key={survey.closure} className="survey-list__item">
            <RatingStars rating={survey.rating} />
            <span className="survey-list__meta">
              Cierre del {formatDateTime(survey.closed_at)} · respondida el{' '}
              {formatDateTime(survey.created_at)}
            </span>
            {survey.comment && <p className="preserve-lines">{survey.comment}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Encuesta del solicitante en "Mis incidencias" (ADR 0012). Invitación discreta, nunca
 * se abre sola; "Ahora no" la deja disponible mientras el cierre siga vigente.
 */
export function SurveyPanel({
  code,
  onDialogChange,
}: {
  code: string
  onDialogChange: (open: boolean) => void
}) {
  const [state, setState] = useState<SurveyState | null>(null)
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState(false)
  const [params, setParams] = useSearchParams()
  const requested = params.get('evaluar') === '1'

  useEffect(() => {
    const controller = new AbortController()
    fetchSurvey(code, controller.signal)
      .then((data) => {
        setState(data)
        // Llegó desde «Evaluar atención» del recordatorio: abre la encuesta una vez y
        // limpia el parámetro para que recargar no la vuelva a abrir.
        if (requested) {
          if (data.pending) {
            setOpen(true)
            onDialogChange(true)
          }
          setParams((current) => {
            const next = new URLSearchParams(current)
            next.delete('evaluar')
            return next
          }, { replace: true })
        }
      })
      .catch(() => {
        // Sin encuesta disponible (o sin conexión): no se muestra nada.
      })
    return () => controller.abort()
    // Solo al cargar el ticket: ``requested`` se consume una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  function toggle(value: boolean) {
    setOpen(value)
    onDialogChange(value)
  }

  if (!state) return null

  return (
    <>
      {confirmation && (
        <Alert tone="success" live="polite">
          Gracias. Registramos tu evaluación.
        </Alert>
      )}
      {state.pending && (
        <section className="detail-card survey-invite" aria-labelledby="survey-invite">
          <h2 id="survey-invite" className="detail-card__title">
            Encuesta de satisfacción
          </h2>
          <p>Tu atención fue finalizada. ¿Deseas evaluar el servicio recibido?</p>
          <p>
            <Button variant="secondary" onClick={() => toggle(true)}>
              Evaluar atención
            </Button>
          </p>
        </section>
      )}
      <SurveyHistory surveys={state.history} title="Tus evaluaciones" />

      {open &&
        state.pending &&
        createPortal(
          <SurveyDialog
            code={code}
            closure={state.pending.closure}
            onCancel={() => toggle(false)}
            onSaved={(next) => {
              setState(next)
              setConfirmation(true)
              toggle(false)
            }}
            onStale={(next) => {
              if (next) setState(next)
            }}
          />,
          document.body,
        )}
    </>
  )
}

function SurveyDialog({
  code,
  closure,
  onCancel,
  onSaved,
  onStale,
}: {
  code: string
  closure: number
  onCancel: () => void
  onSaved: (state: SurveyState) => void
  onStale: (state: SurveyState | null) => void
}) {
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ rating?: string; comment?: string; form?: string }>({})

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (rating === null) {
      setErrors({ rating: 'Selecciona una calificación de 1 a 5 estrellas.' })
      return
    }
    setSaving(true)
    setErrors({})
    try {
      onSaved(await submitSurvey(code, { closure, rating, comment: comment.trim() }))
    } catch (error) {
      if (isApiError(error) && error.kind === 'validation') {
        setErrors({
          rating: error.fieldErrors.rating?.[0],
          comment: error.fieldErrors.comment?.[0],
          form: error.fieldErrors.non_field_errors?.[0],
        })
      } else if (isApiError(error) && error.status === 409) {
        setErrors({ form: error.message })
        onStale(await fetchSurvey(code).catch(() => null))
      } else {
        setErrors({
          form: isApiError(error) ? error.message : 'No se pudo enviar la evaluación. Inténtalo de nuevo.',
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Evalúa tu atención"
      role="dialog"
      onEscape={saving ? undefined : onCancel}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Ahora no
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={rating === null}
            loading={saving}
            loadingText="Enviando…"
          >
            Enviar evaluación
          </Button>
        </>
      }
    >
      <form className="stack survey-form" noValidate onSubmit={(event) => void submit(event)}>
        <p className="survey-form__ticket">
          Ticket <strong>{code}</strong>
        </p>
        {errors.form && (
          <Alert tone="danger" live="assertive">
            {errors.form}
          </Alert>
        )}
        <fieldset className="star-rating" aria-describedby={errors.rating ? 'survey-rating-error' : undefined}>
          <legend className="field__label">
            ¿Qué tan satisfecho estás con la atención recibida?{' '}
            <span className="field__required" aria-hidden="true">
              *
            </span>
          </legend>
          <div className="star-rating__options">
            {RATINGS.map((value) => (
              <label
                key={value}
                className={`star-rating__option${rating !== null && value <= rating ? ' star-rating__option--on' : ''}`}
              >
                <input
                  type="radio"
                  name="survey-rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => {
                    setRating(value)
                    setErrors((current) => ({ ...current, rating: undefined }))
                  }}
                  className="visually-hidden"
                />
                <span aria-hidden="true" className="star-rating__star">
                  ★
                </span>
                <span className="visually-hidden">
                  {value} {value === 1 ? 'estrella' : 'estrellas'}: {RATING_LABELS[value]}
                </span>
              </label>
            ))}
          </div>
          <p className="star-rating__label" aria-live="polite">
            {rating === null ? 'Sin calificación' : `${rating} de 5: ${RATING_LABELS[rating]}`}
          </p>
          {errors.rating && (
            <p id="survey-rating-error" className="field__error">
              {errors.rating}
            </p>
          )}
        </fieldset>
        <TextAreaField
          label="Comentario"
          value={comment}
          maxLength={COMMENT_MAX}
          rows={3}
          onChange={(event) => setComment(event.target.value)}
          error={errors.comment}
        />
      </form>
    </Dialog>
  )
}
