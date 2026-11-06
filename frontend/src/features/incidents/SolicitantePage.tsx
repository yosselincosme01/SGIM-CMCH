import { Link } from 'react-router'

import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'

/** Inicio de la vista Solicitante: acceso al registro y a la consulta de incidencias. */
export function SolicitantePage() {
  useDocumentTitle('Solicitante')
  return (
    <div className="stack">
      <nav aria-label="Ruta de navegación" className="breadcrumb">
        <ol>
          <li>
            <Link to="/">Inicio</Link>
          </li>
          <li aria-current="page">Solicitante</li>
        </ol>
      </nav>

      <header className="page__header">
        <p className="page__eyebrow">Vista</p>
        <h1 className="page__title">Solicitante</h1>
        <p className="page__lead">Registra incidencias y haz seguimiento de las que reportaste.</p>
      </header>

      <ul className="view-grid" aria-label="Acciones">
        <li>
          <Link to="/solicitante/incidencias/nueva" className="view-card">
            <span className="view-card__title">Registrar incidencia</span>
            <span className="view-card__summary">
              Reporta un problema en una UPS o servicio y envíalo al área de soporte.
            </span>
            <span className="view-card__action" aria-hidden="true">
              Registrar →
            </span>
          </Link>
        </li>
        <li>
          <Link to="/solicitante/incidencias" className="view-card">
            <span className="view-card__title">Mis incidencias</span>
            <span className="view-card__summary">Consulta el estado de lo que registraste.</span>
            <span className="view-card__action" aria-hidden="true">
              Consultar →
            </span>
          </Link>
        </li>
      </ul>
    </div>
  )
}
