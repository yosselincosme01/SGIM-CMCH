import { Link } from 'react-router'

import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'

export function ForbiddenPage() {
  useDocumentTitle('Sin acceso')
  return (
    <div className="stack">
      <header className="page__header">
        <h1 className="page__title">No tienes acceso a esta vista</h1>
        <p className="page__lead">
          Tu cuenta no tiene habilitada esta función. Si crees que es un error, contacta al
          administrador del sistema.
        </p>
      </header>
      <p>
        <Link to="/" className="btn btn--primary">
          Volver al inicio
        </Link>
      </p>
    </div>
  )
}

export function NotFoundPage() {
  useDocumentTitle('Página no encontrada')
  return (
    <div className="stack">
      <header className="page__header">
        <h1 className="page__title">Página no encontrada</h1>
        <p className="page__lead">La dirección que buscas no existe.</p>
      </header>
      <p>
        <Link to="/" className="btn btn--primary">
          Volver al inicio
        </Link>
      </p>
    </div>
  )
}
