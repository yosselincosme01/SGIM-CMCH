import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { useCurrentUser } from '../auth/useAuth'
import { FUNCTION_LABELS, isAdministrator, isOperational } from '../navigation/access'

/**
 * Mi cuenta: datos de la cuenta y funciones habilitadas por área, en lenguaje de trabajo
 * y sin nombres de roles internos. Solo consulta: los cambios los hace el Administrador.
 */
export function AccountPage() {
  useDocumentTitle('Mi cuenta')
  const user = useCurrentUser()
  const areas = user.area_functions ?? []

  return (
    <div className="stack">
      <header className="page__header">
        <h1 className="page__title">Mi cuenta</h1>
        <p className="page__lead">
          Para cambiar tus datos o tus funciones, contacta al administrador del sistema.
        </p>
      </header>

      <section className="detail-card" aria-labelledby="account-data">
        <h2 id="account-data" className="detail-card__title">
          Datos
        </h2>
        <dl className="detail-grid">
          <div>
            <dt>Nombre</dt>
            <dd>{user.full_name}</dd>
          </div>
          <div>
            <dt>Usuario</dt>
            <dd>{user.username}</dd>
          </div>
          {user.email && (
            <div>
              <dt>Correo</dt>
              <dd>{user.email}</dd>
            </div>
          )}
        </dl>
      </section>

      <section className="detail-card" aria-labelledby="account-functions">
        <h2 id="account-functions" className="detail-card__title">
          Funciones habilitadas
        </h2>
        <ul className="plain-list">
          {isOperational(user) && <li>Registrar incidencias y consultar las tuyas.</li>}
          {isAdministrator(user) && <li>Administración del sistema.</li>}
        </ul>
        {areas.length > 0 ? (
          <table className="data-table">
            <caption className="visually-hidden">Funciones por área de soporte</caption>
            <thead>
              <tr>
                <th scope="col">Área</th>
                <th scope="col">Funciones</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((area) => (
                <tr key={area.area}>
                  <th scope="row" data-label="Área">
                    {area.area_name}
                  </th>
                  <td data-label="Funciones">
                    {(Object.keys(FUNCTION_LABELS) as (keyof typeof FUNCTION_LABELS)[])
                      .filter((key) => area[key])
                      .map((key) => FUNCTION_LABELS[key])
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No tienes funciones habilitadas en ningún área de soporte.</p>
        )}
      </section>
    </div>
  )
}
