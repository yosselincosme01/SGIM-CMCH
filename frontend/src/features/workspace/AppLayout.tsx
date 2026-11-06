import { type ChangeEvent, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'

import { Button } from '../../shared/ui/Button'
import { InstitutionLogo } from '../../shared/ui/InstitutionLogo'
import { findViewByPath, getAuthorizedViews } from '../auth/roles'
import { useAuth, useCurrentUser } from '../auth/useAuth'
import { SessionMonitor } from '../session/SessionMonitor'

const HOME_VALUE = '/'

/**
 * Layout común de las vistas autenticadas (Administrador, Solicitante, Responsable de
 * Área y Personal de Atención): barra superior guinda con el logotipo institucional en
 * el extremo izquierdo, seguido de la identidad textual de SGIM-CMCH; a la derecha, el
 * selector de vista, el usuario y el cierre de sesión.
 */
export function AppLayout() {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [signingOut, setSigningOut] = useState(false)

  const views = getAuthorizedViews(user)
  const current = findViewByPath(location.pathname)

  function handleViewChange(event: ChangeEvent<HTMLSelectElement>) {
    navigate(event.target.value)
  }

  async function handleLogout() {
    setSigningOut(true)
    await logout()
  }

  return (
    <SessionMonitor>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          {/* Logotipo institucional en el extremo izquierdo, en todas las vistas internas. */}
          <div className="topbar__logo" data-testid="topbar-brand">
            <InstitutionLogo variant="on-guinda" />
          </div>

          <Link to="/" className="topbar__identity" aria-label="SGIM-CMCH, ir al inicio">
            <span className="topbar__name">SGIM-CMCH</span>
            <span className="topbar__tagline">
              Sistema de Gestión de Incidencias y Mantenimiento
            </span>
          </Link>

          <div className="topbar__controls">
            {views.length > 1 && (
              <div className="view-switcher">
                <label htmlFor="view-switcher" className="view-switcher__label">
                  Vista
                </label>
                <select
                  id="view-switcher"
                  className="view-switcher__select"
                  value={current?.path ?? HOME_VALUE}
                  onChange={handleViewChange}
                >
                  <option value={HOME_VALUE}>Inicio</option>
                  {views.map((view) => (
                    <option key={view.role} value={view.path}>
                      {view.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="user-menu">
              <span className="user-menu__name" title={user.username}>
                {user.full_name}
              </span>
              <Button
                variant="ghost"
                onClick={handleLogout}
                loading={signingOut}
                loadingText="Cerrando…"
              >
                Cerrar sesión
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="page" id="contenido" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="footer">
        <p>SGIM-CMCH · Uso exclusivo del personal autorizado. Tu cuenta es personal.</p>
      </footer>
    </SessionMonitor>
  )
}
