import { forwardRef, type TextareaHTMLAttributes, useId } from 'react'

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string
  error?: string
  hint?: string
  /** Muestra el contador de caracteres si se indica el máximo. */
  maxLength?: number
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField({ label, error, hint, required, maxLength, value, ...rest }, ref) {
    const id = useId()
    const hintId = hint ? `${id}-hint` : undefined
    const errorId = error ? `${id}-error` : undefined
    const counterId = maxLength ? `${id}-counter` : undefined
    const length = typeof value === 'string' ? value.length : 0

    return (
      <div className={['field', error && 'field--invalid'].filter(Boolean).join(' ')}>
        <label className="field__label" htmlFor={id}>
          {label}
          {required ? (
            <span className="field__required" aria-hidden="true">
              {' '}
              *
            </span>
          ) : (
            <span className="field__optional"> (opcional)</span>
          )}
        </label>
        {hint && (
          <p id={hintId} className="field__hint">
            {hint}
          </p>
        )}
        <textarea
          {...rest}
          ref={ref}
          id={id}
          value={value}
          maxLength={maxLength}
          className="field__input field__textarea"
          required={required}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId, counterId].filter(Boolean).join(' ') || undefined}
        />
        <div className="field__meta">
          {error ? (
            <p id={errorId} className="field__error">
              {error}
            </p>
          ) : (
            <span />
          )}
          {maxLength && (
            <span id={counterId} className="field__counter">
              {length} / {maxLength}
            </span>
          )}
        </div>
      </div>
    )
  },
)
