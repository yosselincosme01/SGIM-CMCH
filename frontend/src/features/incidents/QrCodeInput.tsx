import { useId } from 'react'

import { QR_CODE_MAX, type QrCaptureMethod } from './equipment'

interface QrCodeInputProps {
  value: string
  /**
   * Recibe el contenido y cómo se obtuvo. Hoy siempre es ``manual``. Un futuro
   * lector con cámara se conectará aquí llamando ``onCode(texto, 'scan')``, sin
   * cambiar el formulario. No se muestra ningún botón de escaneo hasta que exista.
   */
  onCode: (value: string, method: QrCaptureMethod) => void
  error?: string
}

/**
 * Campo para el contenido del QR. El texto se trata siempre como dato: no se
 * interpreta ni se abre, aunque contenga una URL.
 */
export function QrCodeInput({ value, onCode, error }: QrCodeInputProps) {
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
        Escríbelo tal como aparece en la etiqueta del equipo.
      </p>
      <input
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
        onChange={(event) => onCode(event.target.value, 'manual')}
      />
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </div>
  )
}
