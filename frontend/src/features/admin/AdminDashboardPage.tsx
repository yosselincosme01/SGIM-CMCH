import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime, limaToday } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { adminIncidentPath, PATHS } from '../../shared/paths'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import type { Page } from '../incidents/api'
import { StatusBadge } from '../incidents/StatusBadge'
import type { PlanningItem } from '../planning/api'
import { type Dashboard, fetchDashboard, fetchReportOptions, type ReportOptions } from '../reports/api'
import { fetchGlobalIncidents } from './api'
import { DistributionBars } from './DistributionBars'

/** Estados reales del sistema, en el orden del ciclo (ADR 0006). */
const STATUSES = [
  { key: 'registrada', label: 'Registrada' },
  { key: 'asignada', label: 'Asignada' },
  { key: 'cerrada', label: 'Cerrada' },
  { key: 'reabierta', label: 'Reabierta' },
]
const RECENT_COUNT = 5

function daysAgo(days: number): string {
  const today = new Date(`${limaToday()}T12:00:00Z`)
  today.setUTCDate(today.getUTCDate() - days)
  return today.toISOString().slice(0, 10)
}

interface PanelFilters {
  date_from: string
  date_to: string
  area: string
}

export function AdminBreadcrumb({ current }: { current?: string }) {
  return (
    <nav aria-label="Ruta de navegación" className="breadcrumb">
      <ol>
        <li>
          <Link to={PATHS.admin}>Administración</Link>
        </li>
        <li aria-current="page">{current ?? 'Panel de Administración'}</li>
      </ol>
    </nav>
  )
}

/** Consulta global con los mismos filtros del panel (para "Ver todas"). */
function consultaLink(filters: PanelFilters): string {
  const params = new URLSearchParams()
  if (filters.area) params.set('area', filters.area)
  params.set('desde', filters.date_from)
  params.set('hasta', filters.date_to)
  return `${PATHS.adminIncidents}?${params.toString()}`
}

/**
 * Panel de Administración (ADR 0011): supervisión global de solo lectura.
 *
 * - Indicadores y distribuciones: ``GET /reports/dashboard/`` (ADR 0007).
 * - Incidencias recientes: ``GET /admin/incidents/`` con los mismos filtros (ADR 0009).
 *
 * La visibilidad global no da permisos para planificar, atender ni verificar.
 */
export function AdminDashboardPage() {
  useDocumentTitle('Panel de Administración')
  const [options, setOptions] = useState<ReportOptions | null>(null)
  const [draft, setDraft] = useState<PanelFilters>({
    date_from: daysAgo(29),
    date_to: limaToday(),
    area: '',
  })
  const [applied, setApplied] = useState(draft)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [recent, setRecent] = useState<Page<PlanningItem> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchReportOptions(controller.signal)
      .then(setOptions)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(isApiError(err) ? err.message : 'No se pudo cargar.')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchDashboard(applied, controller.signal),
      fetchGlobalIncidents({ ...applied, page: 1 }, controller.signal),
    ])
      .then(([metrics, incidents]) => {
        setDashboard(metrics)
        setRecent(incidents)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        const message =
          isApiError(err) && err.kind === 'validation'
            ? (Object.values(err.fieldErrors)[0]?.[0] ?? err.message)
            : isApiError(err)
              ? err.message
              : 'No se pudo cargar el panel.'
        setError(message)
      })
    return () => controller.abort()
  }, [applied])

  function apply(event: FormEvent) {
    event.preventDefault()
    setDashboard(null)
    setRecent(null)
    setApplied(draft)
  }

  const statusRows = dashboard
    ? STATUSES.map((status) => ({
        ...status,
        total: dashboard.by_status.find((row) => row.key === status.key)?.total ?? 0,
      }))
    : []
  const areaRows =
    dashboard && options
      ? options.areas
          .filter((area) => !applied.area || area.code === applied.area)
          .map((area) => ({
            key: area.code,
            label: area.name,
            total: dashboard.by_area.find((row) => row.key === area.code)?.total ?? 0,
          }))
      : []

  return (
    <div className="stack">
      <header className="page__header">
        <p className="page__eyebrow">Administración</p>
        <h1 className="page__title">Panel de Administración</h1>
        <p className="page__lead">
          Supervisión de las incidencias de todas las áreas. Solo lectura: no permite planificar,
          atender ni verificar.
        </p>
      </header>

      <form className="filters filters--inline admin-filters" onSubmit={apply} aria-label="Filtros del panel">
        <div className="filters__grid">
          <div className="field">
            <label className="field__label" htmlFor="panel-from">
              Registradas desde
            </label>
            <input
              id="panel-from"
              type="date"
              className="field__input"
              value={draft.date_from}
              onChange={(event) => setDraft({ ...draft, date_from: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="panel-to">
              Hasta
            </label>
            <input
              id="panel-to"
              type="date"
              className="field__input"
              value={draft.date_to}
              onChange={(event) => setDraft({ ...draft, date_to: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="panel-area">
              Área de soporte
            </label>
            <select
              id="panel-area"
              className="field__input field__select"
              value={draft.area}
              onChange={(event) => setDraft({ ...draft, area: event.target.value })}
            >
              <option value="">Todas las áreas</option>
              {(options?.areas ?? []).map((area) => (
                <option key={area.code} value={area.code}>
                  {area.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button type="submit" variant="secondary">
          Aplicar
        </Button>
      </form>

      {error ? (
        <Alert tone="danger" title="No se pudo cargar el panel" live="assertive">
          {error}
        </Alert>
      ) : !dashboard || !recent || !options ? (
        <LoadingState label="Cargando panel…" />
      ) : (
        <>
          <section aria-labelledby="panel-kpis">
            <h2 id="panel-kpis" className="visually-hidden">
              Indicadores del periodo
            </h2>
            <ul className="kpi-strip">
              <Kpi label="Registradas" value={dashboard.tickets.total} hint="en el periodo" />
              <Kpi label="Abiertas" value={dashboard.tickets.open} hint="registradas, asignadas o reabiertas" />
              <Kpi label="En proceso" value={dashboard.tickets.in_progress} hint="última intervención sin solucionar" />
              <Kpi label="Cerradas técnicamente" value={dashboard.tickets.closed} hint="con cierre técnico vigente" />
              <Kpi
                label="Pendientes de verificación"
                value={dashboard.tickets.pending_verification}
                hint="de las cerradas"
              />
            </ul>
          </section>

          <div className="distribution-grid">
            <DistributionBars id="panel-by-status" title="Por estado" rows={statusRows} total={dashboard.tickets.total} />
            <DistributionBars id="panel-by-area" title="Por área de soporte" rows={areaRows} total={dashboard.tickets.total} />
          </div>

          <section className="detail-card" aria-labelledby="panel-recent">
            <div className="detail-card__header">
              <h2 id="panel-recent" className="detail-card__title">
                Incidencias recientes
              </h2>
              {recent.count > RECENT_COUNT && (
                <Link to={consultaLink(applied)} className="detail-card__link">
                  Ver las {recent.count} en Consulta de incidencias
                </Link>
              )}
            </div>
            {recent.count === 0 ? (
              <p className="muted">Sin incidencias en el periodo.</p>
            ) : (
              <table className="data-table">
                <caption className="visually-hidden">Incidencias recientes del periodo</caption>
                <thead>
                  <tr>
                    <th scope="col">Ticket</th>
                    <th scope="col">Área</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Registrada</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.results.slice(0, RECENT_COUNT).map((item) => (
                    <tr key={item.code}>
                      <th scope="row" data-label="Ticket">
                        <Link to={adminIncidentPath(item.code)} className="data-table__code">
                          {item.code}
                        </Link>
                        <span className="planning-table__meta">{item.care_unit.name}</span>
                      </th>
                      <td data-label="Área">{item.support_area.name}</td>
                      <td data-label="Estado">
                        <StatusBadge status={item.status} label={item.status_label} />
                      </td>
                      <td data-label="Registrada">{formatDateTime(item.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <li className="kpi">
      <span className="kpi__value">{value}</span>
      <span className="kpi__label">{label}</span>
      <span className="kpi__hint">{hint}</span>
    </li>
  )
}
