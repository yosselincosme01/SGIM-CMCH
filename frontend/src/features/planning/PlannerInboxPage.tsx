import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime, limaToday } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import type { Page } from '../incidents/api'
import { StatusBadge } from '../incidents/StatusBadge'
import {
  fetchPlanningInbox,
  fetchPlanningOptions,
  type PlanningFilters,
  type PlanningItem,
  type PlanningOptions,
} from './api'
import { PLANNER_PATH, plannerIncidentPath } from './paths'
import { PlanningBreadcrumb, PriorityBadge, ProvisionalPriorityNote } from './PlanningParts'

const PAGE_SIZE = 20
const FILTER_KEYS = ['area', 'status', 'priority', 'scheduled_on', 'q', 'ordering', 'queue'] as const

const STATUS_OPTIONS = [
  { value: 'registrada', label: 'Registrada (sin asignar)' },
  { value: 'asignada', label: 'Asignada' },
  { value: 'cerrada', label: 'Cerrada' },
  { value: 'reabierta', label: 'Reabierta (por programar)' },
]
const ORDERING_OPTIONS = [
  { value: '', label: 'Más recientes primero' },
  { value: 'created_at', label: 'Más antiguas primero' },
  { value: 'priority', label: 'Por prioridad (sin evaluar primero)' },
  { value: 'scheduled_at', label: 'Por fecha programada' },
]

function filtersFrom(params: URLSearchParams): PlanningFilters {
  const filters: PlanningFilters = {}
  for (const key of FILTER_KEYS) {
    const value = params.get(key)
    if (value) filters[key] = value
  }
  const page = Number.parseInt(params.get('pagina') ?? '1', 10)
  if (page > 1) filters.page = page
  return filters
}

/** Bandeja del Planificador: solo incidencias de sus áreas autorizadas (lo aplica el backend). */
export function PlannerInboxPage() {
  useDocumentTitle('Planificador')
  const [params, setParams] = useSearchParams()
  const filters = filtersFrom(params)
  const filterKey = params.toString()
  const [options, setOptions] = useState<PlanningOptions | null>(null)
  const [data, setData] = useState<Page<PlanningItem> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState(filters.q ?? '')

  const load = useCallback(
    (signal: AbortSignal, passive: boolean) =>
      Promise.all([
        fetchPlanningOptions(signal, passive),
        fetchPlanningInbox(filtersFrom(new URLSearchParams(filterKey)), signal, passive),
      ]).then(([nextOptions, nextData]) => {
        setOptions(nextOptions)
        setData(nextData)
        setError(null)
      }),
    [filterKey],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal, false).catch((err: unknown) => {
      if (controller.signal.aborted) return
      setError(isApiError(err) ? err.message : 'No se pudo cargar la bandeja.')
    })
    return () => controller.abort()
  }, [load, attempt])

  // Al volver a la pestaña se actualiza en segundo plano (no cuenta como actividad).
  useEffect(() => {
    const controller = new AbortController()
    function onVisible() {
      if (document.visibilityState === 'visible') load(controller.signal, true).catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  function update(changes: Partial<Record<(typeof FILTER_KEYS)[number] | 'pagina', string>>) {
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

  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1
  const page = filters.page ?? 1
  const today = limaToday()
  const hasFilters = FILTER_KEYS.some((key) => key !== 'ordering' && params.get(key))

  return (
    <div className="stack">
      <PlanningBreadcrumb />
      <header className="page__header">
        <p className="page__eyebrow">Vista</p>
        <h1 className="page__title">Planificador</h1>
        <p className="page__lead">
          Prioriza y programa la atención de las incidencias de tus áreas autorizadas.
        </p>
        <p>
          <Link to={`${PLANNER_PATH}/indicadores`} className="btn btn--secondary">
            Indicadores y reportes
          </Link>
        </p>
      </header>

      {error ? (
        <>
          <Alert tone="danger" title="No se pudo cargar la bandeja" live="assertive">
            {error}
          </Alert>
          <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
        </>
      ) : !options ? (
        <LoadingState label="Cargando bandeja…" />
      ) : options.areas.length === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No tienes áreas asignadas como Planificador</h2>
          <p>Solicita al administrador que habilite tu función de Planificador en un área.</p>
        </div>
      ) : (
        <>
          <ul className="summary-chips" aria-label="Resumen de la bandeja">
            <li>
              <button
                type="button"
                className="summary-chip"
                aria-pressed={filters.priority === 'none'}
                onClick={() =>
                  update({ priority: filters.priority === 'none' ? '' : 'none', status: '' })
                }
              >
                <span className="summary-chip__value">{options.counts.unprioritized}</span>
                <span className="summary-chip__label">Sin prioridad</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="summary-chip"
                aria-pressed={filters.status === 'registrada'}
                onClick={() =>
                  update({ status: filters.status === 'registrada' ? '' : 'registrada' })
                }
              >
                <span className="summary-chip__value">{options.counts.unassigned}</span>
                <span className="summary-chip__label">Sin asignar</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="summary-chip"
                aria-pressed={filters.scheduled_on === today}
                onClick={() =>
                  update({ scheduled_on: filters.scheduled_on === today ? '' : today })
                }
              >
                <span className="summary-chip__value">{options.counts.scheduled_today}</span>
                <span className="summary-chip__label">Programadas para hoy</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="summary-chip"
                aria-pressed={filters.queue === 'pending'}
                onClick={() =>
                  update({ queue: filters.queue === 'pending' ? '' : 'pending', status: '' })
                }
              >
                <span className="summary-chip__value">{options.counts.pending}</span>
                <span className="summary-chip__label">Pendientes de atención</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="summary-chip"
                aria-pressed={filters.queue === 'verification'}
                onClick={() =>
                  update({
                    queue: filters.queue === 'verification' ? '' : 'verification',
                    status: '',
                  })
                }
              >
                <span className="summary-chip__value">{options.counts.to_verify}</span>
                <span className="summary-chip__label">Cerradas por verificar</span>
              </button>
            </li>
          </ul>

          <details className="filters" open={hasFilters || undefined}>
            <summary className="filters__toggle">Filtros y orden</summary>
            <div className="filters__body">
              <form className="filters__search" role="search" onSubmit={submitSearch}>
                <label className="field__label" htmlFor="planning-search">
                  Buscar por código o descripción
                </label>
                <div className="filters__search-row">
                  <input
                    id="planning-search"
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
                {options.areas.length > 1 && (
                  <FilterSelect
                    label="Área de soporte"
                    value={filters.area ?? ''}
                    onChange={(value) => update({ area: value })}
                    options={[
                      { value: '', label: 'Todas mis áreas' },
                      ...options.areas.map((area) => ({ value: area.code, label: area.name })),
                    ]}
                  />
                )}
                <FilterSelect
                  label="Estado"
                  value={filters.status ?? ''}
                  onChange={(value) => update({ status: value })}
                  options={[{ value: '', label: 'Todos' }, ...STATUS_OPTIONS]}
                />
                <FilterSelect
                  label="Prioridad"
                  value={filters.priority ?? ''}
                  onChange={(value) => update({ priority: value })}
                  options={[
                    { value: '', label: 'Todas' },
                    { value: 'none', label: 'Sin prioridad' },
                    ...options.priorities.map((level) => ({ value: level.code, label: level.name })),
                  ]}
                />
                <FilterSelect
                  label="Orden"
                  value={filters.ordering ?? ''}
                  onChange={(value) => update({ ordering: value })}
                  options={ORDERING_OPTIONS}
                />
              </div>
              {hasFilters && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearch('')
                    update({ area: '', status: '', priority: '', scheduled_on: '', q: '' })
                  }}
                >
                  Quitar filtros
                </Button>
              )}
              <ProvisionalPriorityNote />
            </div>
          </details>

          {!data ? (
            <LoadingState label="Cargando incidencias…" />
          ) : data.count === 0 ? (
            <div className="empty-state">
              <h2 className="empty-state__title">
                {hasFilters ? 'Ninguna incidencia coincide con los filtros' : 'No hay incidencias'}
              </h2>
              <p>
                {hasFilters
                  ? 'Prueba con otros filtros o quítalos para ver toda la bandeja.'
                  : 'Cuando se registren incidencias para tus áreas, aparecerán aquí.'}
              </p>
            </div>
          ) : (
            <>
              <p className="muted" role="status">
                {data.count === 1 ? '1 incidencia' : `${data.count} incidencias`}
              </p>
              <table className="data-table planning-table">
                <caption className="visually-hidden">
                  Bandeja del Planificador, página {page} de {totalPages}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Prioridad</th>
                    <th scope="col">Problema</th>
                    <th scope="col">UPS / área</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Técnico y fecha</th>
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
                        <span className="planning-table__meta">
                          {formatDateTime(item.created_at)}
                        </span>
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
                        {item.last_result && (
                          <span className="planning-table__meta">
                            Última intervención: {item.last_result.label}
                          </span>
                        )}
                        {item.status === 'cerrada' && item.pending_verification && (
                          <span className="planning-table__meta">Pendiente de verificación</span>
                        )}
                      </td>
                      <td data-label="Técnico y fecha">
                        {item.assignment ? (
                          <>
                            {item.assignment.technician.full_name}
                            <span className="planning-table__meta">
                              {formatDateTime(item.assignment.scheduled_at)}
                            </span>
                          </>
                        ) : (
                          <span className="muted">Sin asignar</span>
                        )}
                      </td>
                      <td data-label="Acción">
                        <Link
                          to={plannerIncidentPath(item.code)}
                          className="btn btn--secondary planning-table__action"
                          aria-label={`${actionLabel(item)} ${item.code}`}
                        >
                          {actionLabel(item)}
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
        </>
      )}
    </div>
  )
}

function actionLabel(item: PlanningItem): string {
  if (item.status === 'cerrada') return item.pending_verification ? 'Verificar' : 'Ver'
  return item.assignment ? 'Ver y reprogramar' : 'Planificar'
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  const id = `filter-${label.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="field__input field__select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
