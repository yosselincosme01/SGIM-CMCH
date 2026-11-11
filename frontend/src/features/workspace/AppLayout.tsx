import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'

import { InstitutionLogo } from '../../shared/ui/InstitutionLogo'
import { useAuth, useCurrentUser } from '../auth/useAuth'
import { SurveyReminder } from '../incidents/SurveyReminder'
import { activeItemPath, buildMenu, homePath } from '../navigation/access'
import { SessionMonitor } from '../session/SessionMonitor'
import { ProfileMenu } from './ProfileMenu'

// Igual que el punto de corte del CSS (styles/index.css).
const MOBILE_QUERY = '(max-width: 56rem)'

function matchesMobile(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches
}

/** Sigue el ancho de pantalla: en móvil el menú es un panel que se abre y se cierra. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(matchesMobile)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/**
 * Layout común de todas las páginas autenticadas (ADR 0009).
 *
 * - Encabezado guinda con el logotipo institucional, la identidad de SGIM-CMCH, el
 *   acceso a "Mi cuenta" y el cierre de sesión.
 * - Menú lateral único, construido con los permisos efectivos del usuario. No hay
 *   selector de roles.
 * - Escritorio: el menú lateral está siempre visible, con ancho fijo y desplazamiento
 *   vertical propio. No hay botón para ocultarlo.
 * - Tabletas y móviles: el menú es un panel que se abre con el botón de menú y se cierra
 *   al elegir una opción, con Escape o tocando fuera.
 */
export function AppLayout() {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const location = useLocation()
  const mobile = useIsMobile()
  // El panel móvil queda abierto solo en la ruta donde se abrió: al navegar, se cierra.
  const [drawerPath, setDrawerPath] = useState<string | null>(null)
  const drawerOpen = drawerPath === location.pathname
  const [signingOut, setSigningOut] = useState(false)
  // Recordatorio de encuestas pendientes (ADR 0012): con el modal abierto, el fondo es inerte.
  const [reminderOpen, setReminderOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)

  const menu = buildMenu(user)
  const active = activeItemPath(menu, location.pathname)
  const sidebarVisible = mobile ? drawerOpen : true

  const closeDrawer = useCallback((returnFocus: boolean) => {
    setDrawerPath(null)
    if (returnFocus) toggleRef.current?.focus()
  }, [])

  // Al abrir el panel móvil, el foco pasa a la primera opción; Escape lo cierra.
  useEffect(() => {
    if (!mobile || !drawerOpen) return
    sidebarRef.current?.querySelector<HTMLElement>('a')?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeDrawer(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mobile, drawerOpen, closeDrawer])

  function toggleDrawer() {
    setDrawerPath(drawerOpen ? null : location.pathname)
  }

  async function handleLogout() {
    setSigningOut(true)
    await logout()
  }

  const shellClass = [
    'shell',
    mobile && drawerOpen ? 'shell--drawer-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <SessionMonitor>
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <header className="topbar" inert={reminderOpen} aria-hidden={reminderOpen || undefined}>
        <div className="topbar__inner">

          {/* Logotipo institucional en el extremo izquierdo, en todas las vistas internas. */}
          <div className="topbar__logo" data-testid="topbar-brand">
            <InstitutionLogo variant="on-guinda" />
          </div>

          <Link to={homePath(user)} className="topbar__identity" aria-label="SGIM-CMCH, ir al inicio">
            <span className="topbar__name">SGIM-CMCH</span>
            <span className="topbar__tagline">
              Sistema de Gestión de Incidencias y Mantenimiento
            </span>
          </Link>

          {/* Solo en tabletas y móviles: abre y cierra el panel del menú. */}
          {mobile && (
            <button
              ref={toggleRef}
              type="button"
              className="menu-toggle"
              aria-controls="menu-principal"
              aria-expanded={drawerOpen}
              aria-label={drawerOpen ? 'Cerrar menú' : 'Abrir menú'}
              title={drawerOpen ? 'Cerrar menú' : 'Abrir menú'}
              onClick={toggleDrawer}
            >
              <span className="menu-toggle__icon" aria-hidden="true" />
            </button>
          )}

          <div className="topbar__controls">
            <ProfileMenu user={user} onLogout={() => void handleLogout()} signingOut={signingOut} />
          </div>
        </div>
      </header>

      <div className={shellClass} inert={reminderOpen} aria-hidden={reminderOpen || undefined}>
        <nav
          id="menu-principal"
          ref={sidebarRef}
          className="sidebar"
          aria-label="Menú principal"
          hidden={!sidebarVisible}
        >
          {menu.map((group) => (
            <section key={group.id} className="sidebar__group" aria-labelledby={`menu-${group.id}`}>
              <h2 id={`menu-${group.id}`} className="sidebar__title">
                {group.label}
              </h2>
              <ul className="sidebar__list">
                {group.items.map((item) => (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={
                        item.path === active ? 'sidebar__link sidebar__link--active' : 'sidebar__link'
                      }
                      aria-current={item.path === active ? 'page' : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        {mobile && drawerOpen && (
          <div className="sidebar-backdrop" aria-hidden="true" onClick={() => closeDrawer(true)} />
        )}

        <main className="page" id="contenido" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {/* La clave por usuario evita que un recordatorio pase de una cuenta a otra. */}
      <SurveyReminder key={user.id} onOpenChange={setReminderOpen} />

      <footer className="footer">
        <p>SGIM-CMCH · Uso exclusivo del personal autorizado. Tu cuenta es personal.</p>
      </footer>
    </SessionMonitor>
  )
}
