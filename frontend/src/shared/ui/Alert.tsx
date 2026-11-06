import { forwardRef, type ReactNode } from 'react'

type Tone = 'info' | 'success' | 'warning' | 'danger'

interface AlertProps {
  tone?: Tone
  title?: string
  children: ReactNode
  /**
   * `assertive` (role="alert") para errores que el usuario debe conocer ya;
   * `polite` (role="status") para avisos informativos.
   */
  live?: 'assertive' | 'polite' | 'off'
  id?: string
}

const ICONS: Record<Tone, string> = { info: 'i', success: '✓', warning: '!', danger: '!' }

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { tone = 'info', title, children, live = 'polite', id },
  ref,
) {
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined
  return (
    <div ref={ref} id={id} className={`alert alert--${tone}`} role={role} tabIndex={-1}>
      <span className="alert__icon" aria-hidden="true">
        {ICONS[tone]}
      </span>
      <div className="alert__body">
        {title && <p className="alert__title">{title}</p>}
        <div className="alert__text">{children}</div>
      </div>
    </div>
  )
})
