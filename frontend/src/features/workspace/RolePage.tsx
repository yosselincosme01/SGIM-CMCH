import { Link } from 'react-router'

import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import type { BackendRole } from '../auth/api'
import { getRoleView } from '../auth/roles'

/**
 * Página inicial de una vista de rol. Todavía no contiene módulos de incidencias:
 * solo prepara el espacio y la navegación.
 */
export function RolePage({ role }: { role: BackendRole }) {
  const view = getRoleView(role)
  useDocumentTitle(view.label)

  return (
    <div className="stack">
      <nav aria-label="Ruta de navegación" className="breadcrumb">
        <ol>
          <li>
            <Link to="/">Inicio</Link>
          </li>
          <li aria-current="page">{view.label}</li>
        </ol>
      </nav>

      <header className="page__header">
        <p className="page__eyebrow">Vista</p>
        <h1 className="page__title">{view.label}</h1>
        <p className="page__lead">{view.summary}</p>
      </header>

      <section className="placeholder" aria-labelledby={`${role}-pending`}>
        <h2 id={`${role}-pending`} className="placeholder__title">
          Módulos en preparación
        </h2>
        <p>
          Las funciones de esta vista estarán disponibles cuando se habilite el módulo de
          incidencias. Los permisos de cada acción los definirá y validará la clínica.
        </p>
      </section>
    </div>
  )
}
