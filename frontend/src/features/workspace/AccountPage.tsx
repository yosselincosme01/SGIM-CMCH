import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { useCurrentUser } from '../auth/useAuth'

/**
 * Mi cuenta: solo los datos personales de la cuenta (nombre, usuario y correo, si lo
 * tiene). No muestra roles, permisos ni funciones por área: son datos internos y no
 * cambian lo que la persona puede hacer. Solo consulta: los cambios los hace el
 * Administrador.
 */
export function AccountPage() {
  useDocumentTitle('Mi cuenta')
  const user = useCurrentUser()

  return (
    <div className="stack account">
      <header className="page__header">
        <h1 className="page__title">Mi cuenta</h1>
      </header>

      <section className="detail-card" aria-labelledby="account-data">
        <h2 id="account-data" className="detail-card__title">
          Datos personales
        </h2>
        <dl className="account__data">
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
              <dt>Correo electrónico</dt>
              <dd>{user.email}</dd>
            </div>
          )}
        </dl>
        <p className="account__note">
          Si necesitas actualizar tus datos, contacta al administrador del sistema.
        </p>
      </section>
    </div>
  )
}
