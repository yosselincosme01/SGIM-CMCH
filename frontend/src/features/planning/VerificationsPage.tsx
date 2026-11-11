import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { verificationIncidentPath } from '../../shared/paths'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import type { Page } from '../incidents/api'
import { fetchPlanningInbox, type PlanningItem } from './api'
import { PriorityBadge } from './PlanningParts'

const PAGE_SIZE = 20

type Tab = 'pending' | 'all'

/**
 * Verificaciones (ADR 0008 y 0009): cierres técnicos de las áreas donde la persona
 * verifica conformidad. "Por verificar" lista solo los que puede verificar: el backend
 * excluye los cierres de intervenciones que ejecutó ella misma. No da acceso a la
 * planificación.
 */
export function VerificationsPage() {
  useDocumentTitle('Verificaciones')
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('vista') === 'todas' ? 'all' : 'pending'
  const page = Math.max(1, Number.parseInt(params.get('pagina') ?? '1', 10) || 1)
  const [data, setData] = useState<Page<PlanningItem> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchPlanningInbox(
      {
        function: 'verify',
        queue: tab === 'pending' ? 'verification' : undefined,
        page,
      },
      controller.signal,
    )
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'No se pudieron cargar las verificaciones.')
      })
    return () => controller.abort()
  }, [tab, page, attempt])

  function go(next: { tab?: Tab; page?: number }) {
    const query = new URLSearchParams()
    if ((next.tab ?? tab) === 'all') query.set('vista', 'todas')
    if ((next.page ?? 1) > 1) query.set('pagina', String(next.page))
    setData(null)
    setParams(query)
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return (
    <div className="stack">
      <header className="page__header">
        <p className="page__eyebrow">Operaciones</p>
        <h1 className="page__title">Verificaciones</h1>
        <p className="page__lead">
          Revisa los cierres técnicos de tus áreas y registra si la atención es conforme. No
          puedes verificar una atención que realizaste.
        </p>
      </header>

      <div className="tabs" role="group" aria-label="Qué cierres mostrar">
        <button
          type="button"
          className="tabs__tab"
          aria-pressed={tab === 'pending'}
          onClick={() => go({ tab: 'pending' })}
        >
          Por verificar
        </button>
        <button
          type="button"
          className="tabs__tab"
          aria-pressed={tab === 'all'}
          onClick={() => go({ tab: 'all' })}
        >
          Todos los cierres
        </button>
      </div>

      {error ? (
        <>
          <Alert tone="danger" title="No se pudieron cargar las verificaciones" live="assertive">
            {error}
          </Alert>
          <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
        </>
      ) : !data ? (
        <LoadingState label="Cargando verificaciones…" />
      ) : data.count === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">
            {tab === 'pending' ? 'No hay cierres por verificar' : 'No hay cierres técnicos'}
          </h2>
          <p>Cuando se cierre técnicamente una incidencia de tus áreas, aparecerá aquí.</p>
        </div>
      ) : (
        <>
          <p className="muted" role="status">
            {data.count === 1 ? '1 incidencia' : `${data.count} incidencias`}
          </p>
          <table className="data-table planning-table">
            <caption className="visually-hidden">
              Verificaciones, página {page} de {totalPages}
            </caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Prioridad</th>
                <th scope="col">Problema</th>
                <th scope="col">UPS / área</th>
                <th scope="col">Verificación</th>
                <th scope="col">
                  <span className="visually-hidden">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((item) => (
                <tr key={item.code}>
                  <th scope="row" data-label="Código">
                    <span className="data-table__code">{item.code}</span>
                    <span className="planning-table__meta">{formatDateTime(item.created_at)}</span>
                  </th>
                  <td data-label="Prioridad">
                    <PriorityBadge priority={item.priority} />
                  </td>
                  <td data-label="Problema" className="planning-table__excerpt">
                    {item.description_excerpt}
                  </td>
                  <td data-label="UPS / área">
                    {item.care_unit.name}
                    <span className="planning-table__meta">{item.support_area.name}</span>
                  </td>
                  <td data-label="Verificación">
                    {item.pending_verification ? 'Pendiente' : 'Registrada'}
                  </td>
                  <td data-label="Acción">
                    <Link
                      to={verificationIncidentPath(item.code)}
                      className="btn btn--secondary planning-table__action"
                      aria-label={`${tab === 'pending' ? 'Verificar' : 'Ver'} ${item.code}`}
                    >
                      {tab === 'pending' ? 'Verificar' : 'Ver'}
                    </Link>
                  </td>
                </tr>
              ))}
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
