import { Link } from 'react-router'

import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { getAuthorizedViews } from '../auth/roles'
import { useCurrentUser } from '../auth/useAuth'

/** Pantalla inicial: acceso a las vistas autorizadas según los roles del usuario. */
export function HomePage() {
  useDocumentTitle('Inicio')
  const user = useCurrentUser()
  const views = getAuthorizedViews(user)

  return (
    <div className="stack">
      <header className="page__header">
        <h1 className="page__title">Hola, {user.first_name || user.full_name}</h1>
        <p className="page__lead">
          {views.length > 1
            ? 'Tienes varias vistas disponibles. Elige con cuál quieres trabajar; puedes cambiar en cualquier momento desde la cabecera.'
            : 'Elige la vista con la que quieres trabajar.'}
        </p>
      </header>

      {views.length === 0 ? (
        <Alert tone="info" title="Tu cuenta todavía no tiene vistas asignadas">
          Contacta al administrador del sistema para que te asigne el rol que corresponde a tus
          funciones.
        </Alert>
      ) : (
        <ul className="view-grid" aria-label="Vistas disponibles">
          {views.map((view) => (
            <li key={view.role}>
              <Link to={view.path} className="view-card">
                <span className="view-card__title">{view.label}</span>
                <span className="view-card__summary">{view.summary}</span>
                <span className="view-card__action" aria-hidden="true">
                  Entrar →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
