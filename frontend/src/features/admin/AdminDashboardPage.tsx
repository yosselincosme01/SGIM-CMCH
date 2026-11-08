import { Link } from 'react-router'

import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { MetricsPanel } from '../reports/MetricsPanel'

export const ADMIN_PATH = '/administrador'

export function AdminBreadcrumb({ current }: { current?: string }) {
  return (
    <nav aria-label="Ruta de navegación" className="breadcrumb">
      <ol>
        <li>
          <Link to="/">Inicio</Link>
        </li>
        {current ? (
          <>
            <li>
              <Link to={ADMIN_PATH}>Administrador</Link>
            </li>
            <li aria-current="page">{current}</li>
          </>
        ) : (
          <li aria-current="page">Administrador</li>
        )}
      </ol>
    </nav>
  )
}

/** Dashboard general del Administrador: indicadores de todas las áreas y reportes. */
export function AdminDashboardPage() {
  useDocumentTitle('Administrador')
  return (
    <div className="stack">
      <AdminBreadcrumb />
      <header className="page__header page__header--with-action">
        <div>
          <p className="page__eyebrow">Vista</p>
          <h1 className="page__title">Administrador</h1>
          <p className="page__lead">
            Indicadores de todas las áreas, reportes y gestión de cuentas operativas. La
            visibilidad global no permite planificar, atender ni cerrar incidencias.
          </p>
        </div>
        <Link to={`${ADMIN_PATH}/usuarios`} className="btn btn--primary">
          Gestionar usuarios
        </Link>
      </header>
      <MetricsPanel />
    </div>
  )
}
