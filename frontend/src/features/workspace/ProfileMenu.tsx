import { type FocusEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'

import { PATHS } from '../../shared/paths'
import type { CurrentUser } from '../auth/api'
import { userInitial } from './userInitial'

/**
 * Menú de perfil de la barra superior (avatar con la inicial).
 *
 * Es un botón desplegable accesible: ``aria-expanded`` y ``aria-controls``. Al abrirse,
 * el foco pasa a «Ver perfil». Se cierra al elegir una opción, con Escape (el foco
 * vuelve al avatar), al hacer clic fuera o al salir del menú con Tab. «Cerrar sesión»
 * usa el flujo seguro existente (``onLogout``).
 */
export function ProfileMenu({
  user,
  onLogout,
  signingOut,
}: {
  user: CurrentUser
  onLogout: () => void
  signingOut: boolean
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!open) return
    firstItemRef.current?.focus()
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close(true)
    }
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Al salir del menú con Tab, se cierra sin robar el foco.
    if (open && !containerRef.current?.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="profile-menu" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="profile-menu__avatar"
        aria-label={`Menú de perfil de ${user.full_name}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{userInitial(user)}</span>
      </button>

      <div id={menuId} className="profile-menu__panel" hidden={!open}>
        <p className="profile-menu__user">
          <span className="profile-menu__name">{user.full_name}</span>
          <span className="profile-menu__username">{user.username}</span>
        </p>
        <ul className="profile-menu__list">
          <li>
            <Link
              ref={firstItemRef}
              to={PATHS.account}
              className="profile-menu__item"
              onClick={() => close(false)}
            >
              Ver perfil
            </Link>
          </li>
          <li>
            <button
              type="button"
              className="profile-menu__item"
              onClick={() => {
                close(false)
                onLogout()
              }}
              disabled={signingOut}
            >
              {signingOut ? 'Cerrando…' : 'Cerrar sesión'}
            </button>
          </li>
        </ul>
      </div>
    </div>
  )
}
