import { Link } from 'react-router'

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
          <Link to="/">Inicio</Link>
        </li>
        <li>
          <Link to="/solicitante">Solicitante</Link>
        </li>
        {throughList && (
          <li>
            <Link to="/solicitante/incidencias">Mis incidencias</Link>
          </li>
        )}
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  )
}
