import { Link } from 'react-router'

import { PATHS } from '../../shared/paths'

interface IncidentBreadcrumbProps {
  current: string
  /** Muestra "Mis incidencias" como nivel intermedio. */
  throughList?: boolean
}

export function IncidentBreadcrumb({ current, throughList = false }: IncidentBreadcrumbProps) {
  return (
    <nav aria-label="Ruta de navegación" className="breadcrumb">
      <ol>
        <li>
          <Link to={PATHS.home}>Inicio</Link>
        </li>
        {throughList && (
          <li>
            <Link to={PATHS.myIncidents}>Mis incidencias</Link>
          </li>
        )}
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  )
}
