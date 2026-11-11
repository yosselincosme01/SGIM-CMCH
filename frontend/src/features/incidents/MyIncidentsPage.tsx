import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { myIncidentPath, PATHS } from '../../shared/paths'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import { fetchMyIncidents, type IncidentSummary, type Page } from './api'
import { IncidentBreadcrumb } from './IncidentBreadcrumb'
import { StatusBadge } from './StatusBadge'
import { formatDateTime } from './validation'

const PAGE_SIZE = 20

export function MyIncidentsPage() {
  useDocumentTitle('Mis incidencias')
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number.parseInt(params.get('pagina') ?? '1', 10) || 1)
  const [data, setData] = useState<Page<IncidentSummary> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchMyIncidents(page, controller.signal)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'No se pudieron cargar tus incidencias.')
      })
    return () => controller.abort()
  }, [page, attempt])

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  function goTo(target: number) {
    setData(null)
    setParams(target > 1 ? { pagina: String(target) } : {})
  }

  return (
    <div className="stack">
      <IncidentBreadcrumb current="Mis incidencias" />
      <header className="page__header page__header--with-action">
        <div>
          <p className="page__eyebrow">General</p>
          <h1 className="page__title">Mis incidencias</h1>
          <p className="page__lead">Incidencias que registraste, de la más reciente a la más antigua.</p>
        </div>
        <Link to={PATHS.newIncident} className="btn btn--primary">
          Registrar incidencia
        </Link>
      </header>

      {error ? (
        <>
          <Alert tone="danger" title="No se pudieron cargar tus incidencias" live="assertive">
            {error}
          </Alert>
          <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
        </>
      ) : !data ? (
        <LoadingState label="Cargando incidencias…" />
      ) : data.count === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">Todavía no registraste incidencias</h2>
          <p>Cuando registres una, podrás seguir su estado desde aquí.</p>
        </div>
      ) : (
        <>
          <table className="data-table">
            <caption className="visually-hidden">
              Mis incidencias, página {page} de {totalPages}
            </caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Registrada</th>
                <th scope="col">UPS / servicio</th>
                <th scope="col">Área de soporte</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((incident) => (
                <tr key={incident.code}>
                  <th scope="row" data-label="Código">
                    <Link to={myIncidentPath(incident.code)} className="data-table__code">
                      {incident.code}
                    </Link>
                  </th>
                  <td data-label="Registrada">{formatDateTime(incident.created_at)}</td>
                  <td data-label="UPS / servicio">{incident.care_unit.name}</td>
                  <td data-label="Área de soporte">{incident.support_area.name}</td>
                  <td data-label="Estado">
                    <StatusBadge status={incident.status} label={incident.status_label} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <nav className="pagination" aria-label="Paginación">
              <Button variant="secondary" disabled={!data.previous} onClick={() => goTo(page - 1)}>
                Anterior
              </Button>
              <span>
                Página {page} de {totalPages}
              </span>
              <Button variant="secondary" disabled={!data.next} onClick={() => goTo(page + 1)}>
                Siguiente
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
