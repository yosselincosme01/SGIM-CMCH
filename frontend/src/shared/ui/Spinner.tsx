interface SpinnerProps {
  size?: 'small' | 'large'
  /** Etiqueta accesible. Si es decorativo (p. ej., dentro de un botón), se oculta. */
  label?: string
  decorative?: boolean
}

export function Spinner({ size = 'large', label = 'Cargando', decorative = false }: SpinnerProps) {
  if (decorative) return <span className={`spinner spinner--${size}`} aria-hidden="true" />
  return (
    <span className={`spinner spinner--${size}`} role="status">
      <span className="visually-hidden">{label}</span>
    </span>
  )
}
