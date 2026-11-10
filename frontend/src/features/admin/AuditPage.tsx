import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import type { Page } from '../incidents/api'
import { AdminBreadcrumb } from './AdminDashboardPage'
import { type AdminOptions, type AuditEntry, fetchAdminOptions, fetchAudit } from './api'

const PAGE_SIZE = 20

/** Resumen legible de los detalles registrados (nunca contienen contraseñas). */
function describe(details: Record<string, unknown>): string[] {
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== '' && value !== undefined)
    .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
}

/** Auditoría (ADR 0007): operaciones administrativas registradas, de solo lectura. */
export function AuditPage() {
  useDocumentTitle('Auditoría')
  const [params, setParams] = useSearchParams()
  const action = params.get('accion') ?? ''
  const page = Math.max(1, Number.parseInt(params.get('pagina') ?? '1', 10) || 1)
  const [options, setOptions] = useState<AdminOptions | null>(null)
  const [data, setData] = useState<Page<AuditEntry> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchAdminOptions(controller.signal)
      .then(setOptions)
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchAudit({ action: action || undefined, page }, controller.signal)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'No se pudo cargar la auditoría.')
      })
    return () => controller.abort()
  }, [action, page])

  function go(next: { action?: string; page?: number }) {
    const query = new URLSearchParams()
    const nextAction = next.action ?? action
    if (nextAction) query.set('accion', nextAction)
    if ((next.page ?? 1) > 1) query.set('pagina', String(next.page))
    setData(null)
    setParams(query)
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return (
    <div className="stack">
      <AdminBreadcrumb current="Auditoría" />
      <header className="page__header">
        <p className="page__eyebrow">Administración</p>
        <h1 className="page__title">Auditoría</h1>
        <p className="page__lead">
          Operaciones administrativas registradas: cuentas, roles, permisos por área, accesos y
          descargas de reportes. No se pueden modificar ni borrar.
        </p>
      </header>

      <div className="filters filters--inline">
        <div className="filters__grid">
          <div className="field">
            <label className="field__label" htmlFor="audit-action">
              Operación
            </label>
            <select
              id="audit-action"
              className="field__input field__select"
              value={action}
              onChange={(event) => go({ action: event.target.value })}
            >
              <option value="">Todas las operaciones</option>
              {(options?.audit_actions ?? []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error ? (
        <Alert tone="danger" title="No se pudo cargar la auditoría" live="assertive">
          {error}
        </Alert>
      ) : !data ? (
        <LoadingState label="Cargando auditoría…" />
      ) : data.count === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No hay operaciones registradas</h2>
        </div>
      ) : (
        <>
          <p className="muted" role="status">
            {data.count === 1 ? '1 operación' : `${data.count} operaciones`}
          </p>
          <table className="data-table">
            <caption className="visually-hidden">
              Auditoría, página {page} de {totalPages}
            </caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Operación</th>
                <th scope="col">Autor</th>
                <th scope="col">Cuenta afectada</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((entry) => {
                const lines = describe(entry.details)
                return (
                  <tr key={entry.id}>
                    <th scope="row" data-label="Fecha">
                      {formatDateTime(entry.created_at)}
                    </th>
                    <td data-label="Operación">{entry.action_label}</td>
                    <td data-label="Autor">{entry.actor}</td>
                    <td data-label="Cuenta afectada">{entry.target_user ?? '—'}</td>
                    <td data-label="Detalle">
                      {lines.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <details className="audit-details">
                          <summary>Ver detalle</summary>
                          <ul>
                            {lines.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {totalPages > 1 && (
            <nav className="pagination" aria-label="Paginación">
              <Button variant="secondary" disabled={!data.previous} onClick={() => go({ page: page - 1 })}>
                Anterior
              </Button>
              <span>
                Página {page} de {totalPages}
              </span>
              <Button variant="secondary" disabled={!data.next} onClick={() => go({ page: page + 1 })}>
                Siguiente
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
