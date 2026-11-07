import { forwardRef, useId } from 'react'

import { QR_CODE_MAX } from './equipment'

interface QrCodeInputProps {
  value: string
  /** Texto escrito por el usuario (forma de captura `manual`). */
  onChange: (value: string) => void
  hint: string
  error?: string
}

/**
 * Campo del contenido del QR. Recibe tanto lo escrito como lo leído con la cámara.
 * El texto se trata siempre como dato: no se interpreta ni se abre, aunque sea una URL.
 */
export const QrCodeInput = forwardRef<HTMLInputElement, QrCodeInputProps>(function QrCodeInput(
  { value, onChange, hint, error },
  ref,
) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  return (
    <div className={['field', error && 'field--invalid'].filter(Boolean).join(' ')}>
      <label className="field__label" htmlFor={id}>
        Contenido del código QR
        <span className="field__required" aria-hidden="true">
          {' '}
          *
        </span>
      </label>
      <p id={hintId} className="field__hint">
        {hint}
      </p>
      <input
        ref={ref}
        id={id}
        className="field__input qr-code-input"
        type="text"
        value={value}
        maxLength={QR_CODE_MAX}
        required
        aria-required
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </div>
  )
})
