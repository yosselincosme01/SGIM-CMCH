import { type FormEvent, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import type { Page } from '../incidents/api'
import { ADMIN_PATH, AdminBreadcrumb } from './AdminDashboardPage'
import { type AdminOptions, type AdminUser, fetchAdminOptions, fetchUsers } from './api'
import { ROLE_LABELS } from './labels'

const PAGE_SIZE = 20

/** Gestión de usuarios: búsqueda, filtros y paginación. */
export function UsersPage() {
  useDocumentTitle('Usuarios')
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
      <AdminBreadcrumb current="Usuarios" />
      <header className="page__header page__header--with-action">
        <div>
          <p className="page__eyebrow">Administrador</p>
          <h1 className="page__title">Usuarios</h1>
          <p className="page__lead">
            Cuentas operativas: Solicitante, Planificador y Personal de Atención.
          </p>
        </div>
        <Link to={`${ADMIN_PATH}/usuarios/nuevo`} className="btn btn--primary">
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
              Rol
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
          <table className="data-table">
            <caption className="visually-hidden">Usuarios, página {filters.page}</caption>
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col">Nombre</th>
                <th scope="col">Roles</th>
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="visually-hidden">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((user) => (
                <tr key={user.id}>
                  <th scope="row" data-label="Usuario">
                    {user.username}
                  </th>
                  <td data-label="Nombre">{user.full_name}</td>
                  <td data-label="Roles">
                    {user.roles.length ? user.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') : 'Sin roles'}
                  </td>
                  <td data-label="Estado">
                    <span className={`badge ${user.is_active ? 'badge--asignada' : 'badge--cerrada'}`}>
                      {user.is_active ? 'Activa' : 'Desactivada'}
                    </span>
                    {user.is_protected && <span className="planning-table__meta">Cuenta protegida</span>}
                  </td>
                  <td data-label="Acción">
                    <Link
                      to={`${ADMIN_PATH}/usuarios/${user.id}`}
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
