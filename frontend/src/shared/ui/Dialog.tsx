import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef } from 'react'

interface DialogProps {
  title: string
  children: ReactNode
  actions: ReactNode
  /** `alertdialog` para avisos que requieren una decisión del usuario. */
  role?: 'dialog' | 'alertdialog'
  /** Si se indica, Escape cierra el diálogo (para diálogos que se pueden descartar). */
  onEscape?: () => void
}

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo modal accesible: mueve el foco al primer botón, lo mantiene dentro del
 * diálogo y lo devuelve al elemento anterior al cerrarse. El contenido de fondo debe
 * marcarse como `inert` por quien lo usa.
 */
export function Dialog({ title, children, actions, role = 'alertdialog', onEscape }: DialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => previous?.focus?.()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault()
      onEscape()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={panelRef}
        className="dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="dialog__title">
          {title}
        </h2>
        <div id={bodyId} className="dialog__body">
          {children}
        </div>
        <div className="dialog__actions">{actions}</div>
      </div>
    </div>
  )
}
