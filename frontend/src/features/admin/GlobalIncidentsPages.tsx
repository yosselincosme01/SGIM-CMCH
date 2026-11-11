import { type FormEvent, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { adminIncidentPath, PATHS } from '../../shared/paths'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import type { IncidentDetail, Page } from '../incidents/api'
import { IncidentHistory, IncidentSummaryCard } from '../incidents/IncidentDetailSections'
import { InterventionHistory } from '../incidents/InterventionHistory'
import { SurveyHistory } from '../incidents/SatisfactionSurvey'
import { StatusBadge } from '../incidents/StatusBadge'
import type { PlanningItem } from '../planning/api'
import { PriorityBadge } from '../planning/PlanningParts'
import { AdminBreadcrumb } from './AdminDashboardPage'
import {
  type AdminOptions,
  fetchAdminOptions,
  fetchGlobalIncident,
  fetchGlobalIncidents,
  type GlobalIncidentDetail,
  type GlobalIncidentFilters,
} from './api'

const PAGE_SIZE = 20
const FILTER_KEYS = ['area', 'status', 'priority', 'q'] as const
/** Parámetros de la URL para el periodo: ``desde`` y ``hasta`` (AAAA-MM-DD). */
const PERIOD_KEYS = { desde: 'date_from', hasta: 'date_to' } as const

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'registrada', label: 'Registrada' },
  { value: 'asignada', label: 'Asignada' },
  { value: 'cerrada', label: 'Cerrada' },
  { value: 'reabierta', label: 'Reabierta' },
]

function filtersFrom(params: URLSearchParams): GlobalIncidentFilters {
  const filters: GlobalIncidentFilters = {}
  for (const key of FILTER_KEYS) {
    const value = params.get(key)
    if (value) filters[key] = value
  }
  for (const [param, key] of Object.entries(PERIOD_KEYS)) {
    const value = params.get(param)
    if (value) filters[key] = value
  }
  const page = Number.parseInt(params.get('pagina') ?? '1', 10)
  if (page > 1) filters.page = page
  return filters
}

/**
 * Consulta global de incidencias (ADR 0009): todas las áreas, solo lectura. No ofrece
 * acciones de planificación, atención ni verificación.
 */
export function GlobalIncidentsPage() {
  useDocumentTitle('Consulta de incidencias')
  const [params, setParams] = useSearchParams()
  const filterKey = params.toString()
  const filters = filtersFrom(params)
  const [options, setOptions] = useState<AdminOptions | null>(null)
  const [data, setData] = useState<Page<PlanningItem> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(filters.q ?? '')

  useEffect(() => {
    const controller = new AbortController()
    fetchAdminOptions(controller.signal)
      .then(setOptions)
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchGlobalIncidents(filtersFrom(new URLSearchParams(filterKey)), controller.signal)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'No se pudo cargar la consulta.')
      })
    return () => controller.abort()
  }, [filterKey])

  function update(
    changes: Partial<Record<(typeof FILTER_KEYS)[number] | keyof typeof PERIOD_KEYS | 'pagina', string>>,
  ) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('pagina' in changes)) next.delete('pagina')
    setData(null)
    setParams(next)
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault()
    update({ q: search.trim() })
  }

  function clearFilters() {
    setSearch('')
    setData(null)
    setParams(new URLSearchParams())
  }

  const hasFilters = params.toString().replace(/(^|&)pagina=\d+/, '') !== ''

  const page = filters.page ?? 1
  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1

  return (
    <div className="stack">
      <AdminBreadcrumb current="Consulta de incidencias" />
      <header className="page__header">
        <p className="page__eyebrow">Administración</p>
        <h1 className="page__title">Consulta de incidencias</h1>
        <p className="page__lead">
          Incidencias de todas las áreas, en modo lectura. No incluye fotografías ni evidencias.
        </p>
      </header>

      <div className="filters filters--inline">
        <form className="filters__search" role="search" onSubmit={submitSearch}>
          <label className="field__label" htmlFor="global-search">
            Buscar por ticket o descripción
          </label>
          <div className="filters__search-row">
            <input
              id="global-search"
              className="field__input"
              type="search"
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
            <label className="field__label" htmlFor="global-area">
              Área de soporte
            </label>
            <select
              id="global-area"
              className="field__input field__select"
              value={filters.area ?? ''}
              onChange={(event) => update({ area: event.target.value })}
            >
              <option value="">Todas las áreas</option>
              {(options?.areas ?? []).map((area) => (
                <option key={area.code} value={area.code}>
                  {area.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="global-status">
              Estado
            </label>
            <select
              id="global-status"
              className="field__input field__select"
              value={filters.status ?? ''}
              onChange={(event) => update({ status: event.target.value })}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="global-from">
              Registradas desde
            </label>
            <input
              id="global-from"
              type="date"
              className="field__input"
              value={filters.date_from ?? ''}
              onChange={(event) => update({ desde: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="global-to">
              Hasta
            </label>
            <input
              id="global-to"
              type="date"
              className="field__input"
              value={filters.date_to ?? ''}
              onChange={(event) => update({ hasta: event.target.value })}
            />
          </div>
        </div>
        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters}>
            Limpiar filtros
          </Button>
        )}
      </div>

      {error ? (
        <Alert tone="danger" title="No se pudo cargar la consulta" live="assertive">
          {error}
        </Alert>
      ) : !data ? (
        <LoadingState label="Cargando incidencias…" />
      ) : data.count === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">Ninguna incidencia coincide con la búsqueda</h2>
        </div>
      ) : (
        <>
          <p className="muted" role="status">
            {data.count === 1 ? '1 incidencia' : `${data.count} incidencias`}
          </p>
          <table className="data-table planning-table">
            <caption className="visually-hidden">
              Consulta global de incidencias, página {page} de {totalPages}
            </caption>
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Prioridad</th>
                <th scope="col">Problema</th>
                <th scope="col">UPS / área</th>
                <th scope="col">Estado</th>
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
                  <td data-label="Estado">
                    <StatusBadge status={item.status} label={item.status_label} />
                    {item.pending_verification && (
                      <span className="planning-table__meta">Pendiente de verificación</span>
                    )}
                  </td>
                  <td data-label="Acción">
                    <Link
                      to={adminIncidentPath(item.code)}
                      className="btn btn--secondary planning-table__action"
                      aria-label={`Ver ${item.code}`}
                    >
                      Ver
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
                onClick={() => update({ pagina: page - 1 > 1 ? String(page - 1) : '' })}
              >
                Anterior
              </Button>
              <span>
                Página {page} de {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={!data.next}
                onClick={() => update({ pagina: String(page + 1) })}
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

type DetailState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; incident: GlobalIncidentDetail }

/** Detalle de solo lectura, sin evidencia y sin acciones (ADR 0009). */
export function GlobalIncidentDetailPage() {
  const { code = '' } = useParams()
  const validCode = /^[A-Za-z0-9-]{3,20}$/.test(code)
  const [state, setState] = useState<DetailState>(
    validCode ? { status: 'loading' } : { status: 'not-found' },
  )
  useDocumentTitle(state.status === 'ready' ? `${state.incident.code} · Consulta` : 'Consulta de incidencias')

  useEffect(() => {
    if (!validCode) return
    const controller = new AbortController()
    fetchGlobalIncident(code, controller.signal)
      .then((incident) => setState({ status: 'ready', incident }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        if (isApiError(err) && err.status === 404) setState({ status: 'not-found' })
        else setState({ status: 'error', message: isApiError(err) ? err.message : 'Error.' })
      })
    return () => controller.abort()
  }, [code, validCode])

  if (state.status === 'loading') return <LoadingState label="Cargando incidencia…" />
  if (state.status !== 'ready') {
    return (
      <div className="stack">
        <AdminBreadcrumb current="Detalle" />
        <Alert tone={state.status === 'not-found' ? 'warning' : 'danger'} title="No se pudo mostrar la incidencia">
          {state.status === 'not-found' ? 'El código no existe.' : state.message}
        </Alert>
        <p>
          <Link to={PATHS.adminIncidents} className="btn btn--secondary">
            Volver a la consulta
          </Link>
        </p>
      </div>
    )
  }

  const { incident } = state
  // Las secciones compartidas esperan el formato del detalle; sin evidencia descargable.
  const shared = { ...incident, attachments: [] } as IncidentDetail

  return (
    <div className="stack">
      <AdminBreadcrumb current={incident.code} />
      <header className="page__header page__header--with-action">
        <div>
          <p className="page__eyebrow">Consulta · {incident.support_area.name}</p>
          <h1 className="page__title">{incident.code}</h1>
          <p className="page__lead">
            Registrada el {formatDateTime(incident.created_at)} por {incident.created_by.full_name}
          </p>
        </div>
        <div className="planning-header__badges">
          <PriorityBadge priority={incident.priority} />
          <StatusBadge status={incident.status} label={incident.status_label} />
        </div>
      </header>

      <Alert tone="info">
        Modo lectura. Esta consulta no permite planificar, atender ni verificar, y no muestra
        fotografías ni evidencias.
        {incident.attachment_count > 0 &&
          ` El registro tiene ${incident.attachment_count === 1 ? '1 fotografía' : `${incident.attachment_count} fotografías`}.`}
      </Alert>

      <div className="stack">
        <IncidentSummaryCard incident={shared} />
        {incident.assignment && (
          <section className="detail-card" aria-labelledby="global-assignment">
            <h2 id="global-assignment" className="detail-card__title">
              Atención programada
            </h2>
            <dl className="detail-grid">
              <div>
                <dt>Técnico responsable</dt>
                <dd>{incident.assignment.technician.full_name}</dd>
              </div>
              <div>
                <dt>Fecha y hora estimada</dt>
                <dd>{formatDateTime(incident.assignment.scheduled_at)}</dd>
              </div>
            </dl>
          </section>
        )}
        <InterventionHistory interventions={incident.interventions ?? []} />
        <SurveyHistory surveys={incident.surveys ?? []} />
        <IncidentHistory events={incident.events} />
      </div>

      <p>
        <Link to={PATHS.adminIncidents} className="btn btn--secondary">
          Volver a la consulta
        </Link>
      </p>
    </div>
  )
}
