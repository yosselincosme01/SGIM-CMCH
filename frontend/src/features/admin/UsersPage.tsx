import { type FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import type { Page } from '../incidents/api'
import { adminUserPath, PATHS } from '../../shared/paths'
import { AdminBreadcrumb } from './AdminDashboardPage'
import { type AdminOptions, type AdminUser, fetchAdminOptions, fetchUsers } from './api'
import { AREA_FUNCTION_LABELS, ROLE_LABELS } from './labels'
import { formatDateTime } from '../../shared/dates'

const PAGE_SIZE = 20

/** Gestión de usuarios: búsqueda, filtros y paginación. */
export function UsersPage() {
  useDocumentTitle('Usuarios y permisos')
  const [params, setParams] = useSearchParams()
  const filters = {
    q: params.get('q') ?? '',
    role: params.get('rol') ?? '',
    active: params.get('estado') ?? '',
    area: params.get('area') ?? '',
    page: Math.max(1, Number.parseInt(params.get('pagina') ?? '1', 10) || 1),
  }
  const key = params.toString()
  const [search, setSearch] = useState(filters.q)
  const [options, setOptions] = useState<AdminOptions | null>(null)
  const [data, setData] = useState<Page<AdminUser> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchAdminOptions(controller.signal).then(setOptions).catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const current = new URLSearchParams(key)
    fetchUsers(
      {
        q: current.get('q') ?? '',
        role: current.get('rol') ?? '',
        active: current.get('estado') ?? '',
        area: current.get('area') ?? '',
        page: Number.parseInt(current.get('pagina') ?? '1', 10) || 1,
      },
      controller.signal,
    )
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(isApiError(err) ? err.message : 'No se pudo cargar.')
      })
    return () => controller.abort()
  }, [key])

  function update(changes: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value)
      else next.delete(name)
    }
    if (!('pagina' in changes)) next.delete('pagina')
    setData(null)
    setParams(next)
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    update({ q: search.trim() })
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return (
    <div className="stack">
      <AdminBreadcrumb current="Usuarios y permisos" />
      <header className="page__header page__header--with-action">
        <div>
          <p className="page__eyebrow">Administración</p>
          <h1 className="page__title">Usuarios y permisos</h1>
          <p className="page__lead">
            Cuentas operativas, sus roles internos y sus permisos independientes por área.
          </p>
        </div>
        <Link to={PATHS.adminNewUser} className="btn btn--primary">
          Nuevo usuario
        </Link>
      </header>

      <div className="filters filters--inline">
        <form className="filters__search" role="search" onSubmit={submitSearch}>
          <label className="field__label" htmlFor="users-search">
            Buscar por usuario, nombre o correo
          </label>
          <div className="filters__search-row">
            <input
              id="users-search"
              type="search"
              className="field__input"
              maxLength={100}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <Button type="submit" variant="secondary">
              Buscar
            </Button>
          </div>
        </form>
        <div className="filters__grid">
          <div className="field">
            <label className="field__label" htmlFor="users-role">
              Rol interno
            </label>
            <select
              id="users-role"
              className="field__input field__select"
              value={filters.role}
              onChange={(event) => update({ rol: event.target.value })}
            >
              <option value="">Todos</option>
              {Object.entries(ROLE_LABELS).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="users-active">
              Estado
            </label>
            <select
              id="users-active"
              className="field__input field__select"
              value={filters.active}
              onChange={(event) => update({ estado: event.target.value })}
            >
              <option value="">Todos</option>
              <option value="true">Activas</option>
              <option value="false">Desactivadas</option>
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="users-area">
              Área
            </label>
            <select
              id="users-area"
              className="field__input field__select"
              value={filters.area}
              onChange={(event) => update({ area: event.target.value })}
            >
              <option value="">Todas</option>
              {options?.areas.map((area) => (
                <option key={area.code} value={area.code}>
                  {area.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error ? (
        <Alert tone="danger" title="No se pudieron cargar los usuarios" live="assertive">
          {error}
        </Alert>
      ) : !data ? (
        <LoadingState label="Cargando usuarios…" />
      ) : data.count === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No hay usuarios con esos filtros</h2>
        </div>
      ) : (
        <>
          <p className="muted" role="status">
            {data.count === 1 ? '1 cuenta' : `${data.count} cuentas`}
          </p>
          <table className="data-table users-table">
            <caption className="visually-hidden">Usuarios, página {filters.page}</caption>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Roles internos</th>
                <th scope="col">Permisos por área</th>
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="visually-hidden">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((user) => (
                <tr key={user.id}>
                  <th scope="row" data-label="Persona">
                    <span className="users-table__name">{user.full_name}</span>
                    <span className="planning-table__meta">{user.username}</span>
                  </th>
                  <td data-label="Roles internos">
                    {user.roles.length ? (
                      <ul className="chip-list" aria-label={`Roles de ${user.username}`}>
                        {user.roles.map((role) => (
                          <li key={role} className="chip">
                            {ROLE_LABELS[role] ?? role}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="muted">Sin roles</span>
                    )}
                  </td>
                  <td data-label="Permisos por área">
                    <AreaPermissions memberships={user.memberships} />
                  </td>
                  <td data-label="Estado">
                    <span className={`badge ${user.is_active ? 'badge--active' : 'badge--inactive'}`}>
                      {user.is_active ? 'Activa' : 'Desactivada'}
                    </span>
                    {user.is_protected && <span className="planning-table__meta">Cuenta protegida</span>}
                    <span className="planning-table__meta">
                      {user.last_login ? `Último acceso: ${formatDateTime(user.last_login)}` : 'Sin accesos'}
                    </span>
                  </td>
                  <td data-label="Acción">
                    <Link
                      to={adminUserPath(user.id)}
                      className="btn btn--secondary"
                      aria-label={`${user.is_protected ? 'Ver' : 'Editar'} ${user.username}`}
                    >
                      {user.is_protected ? 'Ver' : 'Editar'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="Paginación">
              <Button
                variant="secondary"
                disabled={!data.previous}
                onClick={() => update({ pagina: filters.page - 1 > 1 ? String(filters.page - 1) : '' })}
              >
                Anterior
              </Button>
              <span>
                Página {filters.page} de {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={!data.next}
                onClick={() => update({ pagina: String(filters.page + 1) })}
              >
                Siguiente
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

const FUNCTION_KEYS = Object.keys(AREA_FUNCTION_LABELS) as (keyof typeof AREA_FUNCTION_LABELS)[]

/** Permisos habilitados por área. Las pertenencias sin ningún permiso no se muestran. */
function AreaPermissions({ memberships }: { memberships: AdminUser['memberships'] }) {
  const enabled = memberships
    .map((membership) => ({
      area: membership.area_name ?? membership.area,
      labels: FUNCTION_KEYS.filter((key) => membership[key]).map((key) => AREA_FUNCTION_LABELS[key]),
    }))
    .filter((item) => item.labels.length > 0)
  if (enabled.length === 0) return <span className="muted">Ninguno</span>
  return (
    <ul className="users-table__areas">
      {enabled.map((item) => (
        <li key={item.area}>
          <strong>{item.area}:</strong> {item.labels.join(' · ')}
        </li>
      ))}
    </ul>
  )
}
