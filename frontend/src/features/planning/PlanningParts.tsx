import { Link } from 'react-router'

import type { PriorityLevel } from '../incidents/api'
import { type PlanningMode, sectionLabel, sectionPath } from './paths'

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

export function PlanningBreadcrumb({
  current,
  mode = 'plan',
}: {
  current?: string
  mode?: PlanningMode
}) {
  return (
    <nav aria-label="Ruta de navegación" className="breadcrumb">
      <ol>
        <li>
          <Link to="/">Inicio</Link>
        </li>
        {current ? (
          <>
            <li>
              <Link to={sectionPath(mode)}>{sectionLabel(mode)}</Link>
            </li>
            <li aria-current="page">{current}</li>
          </>
        ) : (
          <li aria-current="page">{sectionLabel(mode)}</li>
        )}
      </ol>
    </nav>
  )
}
