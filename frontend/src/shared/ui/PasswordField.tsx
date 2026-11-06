import { forwardRef, useState } from 'react'

import { TextField, type TextFieldProps } from './TextField'

type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'trailing'>

/**
 * Campo de contraseña con botón para mostrarla u ocultarla.
 * La contraseña solo vive en el estado del formulario; nunca se guarda ni se registra.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(props, ref) {
    const [visible, setVisible] = useState(false)

    return (
      <TextField
        {...props}
        ref={ref}
        type={visible ? 'text' : 'password'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        trailing={
          <button
            type="button"
            className="field__toggle"
            aria-pressed={visible}
            aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? 'Ocultar' : 'Mostrar'}
          </button>
        }
      />
    )
  },
)
