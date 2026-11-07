import { Link } from 'react-router'

import type { PriorityLevel } from '../incidents/api'
import { PLANNER_PATH } from './paths'

/** Prioridad siempre con texto (no solo color). Los niveles son provisionales. */
export function PriorityBadge({ priority }: { priority: PriorityLevel | null | undefined }) {
  if (!priority) return <span className="priority priority--none">Sin prioridad</span>
  return <span className={`priority priority--${priority.code}`}>{priority.name}</span>
}

export function ProvisionalPriorityNote() {
  return (
    <p className="field__hint provisional-note">
      Niveles de prioridad provisionales, pendientes de validación institucional. No tienen
      plazos de atención asociados.
    </p>
  )
}

export function PlanningBreadcrumb({ current }: { current?: string }) {
  return (
    <nav aria-label="Ruta de navegación" className="breadcrumb">
      <ol>
        <li>
          <Link to="/">Inicio</Link>
        </li>
        {current ? (
          <>
            <li>
              <Link to={PLANNER_PATH}>Planificador</Link>
            </li>
            <li aria-current="page">{current}</li>
          </>
        ) : (
          <li aria-current="page">Planificador</li>
        )}
      </ol>
    </nav>
  )
}
