import { type FormEvent, useEffect, useState } from 'react'

import { isApiError } from '../../shared/api/errors'
import { limaToday } from '../../shared/dates'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import {
  type Breakdown,
  type Dashboard,
  downloadReport,
  fetchDashboard,
  fetchReportOptions,
  type MetricFilters,
  type ReportOptions,
} from './api'

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'registrada', label: 'Registrada' },
  { value: 'asignada', label: 'Asignada' },
  { value: 'cerrada', label: 'Cerrada' },
  { value: 'reabierta', label: 'Reabierta' },
]

function daysAgo(days: number): string {
  const today = new Date(`${limaToday()}T12:00:00Z`)
  today.setUTCDate(today.getUTCDate() - days)
  return today.toISOString().slice(0, 10)
}

function hours(value: number | null): string {
  return value === null ? 'Sin datos' : `${value.toLocaleString('es-PE')} h`
}

/**
 * Indicadores y centro de reportes, compartidos por el Administrador (todas las áreas)
 * y el Responsable de Área (sus áreas). El alcance lo aplica el backend.
 *
 * ``mode``: ``indicators`` muestra los indicadores; ``reports``, la descarga de reportes
 * Excel. Ambos usan los mismos filtros.
 */
export function MetricsPanel({ mode }: { mode: 'indicators' | 'reports' }) {
  const [options, setOptions] = useState<ReportOptions | null>(null)
  const [filters, setFilters] = useState<MetricFilters>({
    date_from: daysAgo(29),
    date_to: limaToday(),
    area: '',
    status: '',
  })
  const [applied, setApplied] = useState(filters)
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

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
    if (mode !== 'indicators') return
    const controller = new AbortController()
    fetchDashboard(applied, controller.signal)
      .then((data) => {
        setDashboard(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'No se pudieron calcular los indicadores.')
      })
    return () => controller.abort()
  }, [applied, mode])

  function apply(event: FormEvent) {
    event.preventDefault()
    setDashboard(null)
    setApplied(filters)
  }

  async function download(code: string, label: string) {
    setDownloading(code)
    setNotice(null)
    try {
      const name = await downloadReport(code, applied)
      setNotice({ tone: 'success', text: `Se descargó «${label}» (${name}).` })
    } catch (err) {
      const message =
        isApiError(err) && err.kind === 'validation'
          ? (Object.values(err.fieldErrors)[0]?.[0] ?? err.message)
          : isApiError(err)
            ? err.message
            : 'No se pudo descargar el reporte.'
      setNotice({ tone: 'danger', text: message })
    } finally {
      setDownloading(null)
    }
  }

  if (error && !dashboard) {
    return (
      <Alert tone="danger" title="No se pudieron cargar los indicadores" live="assertive">
        {error}
      </Alert>
    )
  }
  if (!options) return <LoadingState label="Cargando indicadores…" />

  const scopeLabel = options.scope === 'global' ? 'Todas las áreas' : 'Tus áreas autorizadas'

  return (
    <div className="stack">
      <form
        className="filters filters--inline"
        onSubmit={apply}
        aria-label={mode === 'reports' ? 'Filtros de reportes' : 'Filtros de indicadores'}
      >
        <p className="muted">
          Alcance: <strong>{scopeLabel}</strong>. Incidencias registradas en el rango (hora de
          Lima), hasta {options.max_range_days} días.
        </p>
        <div className="filters__grid">
          <div className="field">
            <label className="field__label" htmlFor="metrics-from">
              Desde
            </label>
            <input
              id="metrics-from"
              type="date"
              className="field__input"
              value={filters.date_from}
              onChange={(event) => setFilters({ ...filters, date_from: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="metrics-to">
              Hasta
            </label>
            <input
              id="metrics-to"
              type="date"
              className="field__input"
              value={filters.date_to}
              onChange={(event) => setFilters({ ...filters, date_to: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="metrics-area">
              Área
            </label>
            <select
              id="metrics-area"
              className="field__input field__select"
              value={filters.area}
              onChange={(event) => setFilters({ ...filters, area: event.target.value })}
            >
              <option value="">{scopeLabel}</option>
              {options.areas.map((area) => (
                <option key={area.code} value={area.code}>
                  {area.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="metrics-status">
              Estado
            </label>
            <select
              id="metrics-status"
              className="field__input field__select"
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Button type="submit" variant="secondary">
          Aplicar filtros
        </Button>
      </form>

      {error && (
        <Alert tone="danger" live="assertive">
          {error}
        </Alert>
      )}

      {mode === 'reports' ? null : !dashboard ? (
        <LoadingState label="Calculando indicadores…" />
      ) : (
        <>
          <section aria-labelledby="metrics-tickets">
            <h2 id="metrics-tickets" className="section-title">
              Incidencias (por ticket)
            </h2>
            <ul className="metric-grid">
              <Metric label="Total" value={dashboard.tickets.total} />
              <Metric label="Abiertas" value={dashboard.tickets.open} />
              <Metric label="Pendientes de gestión" value={dashboard.tickets.pending_management} hint="Registradas o reabiertas por programar" />
              <Metric label="En proceso" value={dashboard.tickets.in_progress} hint="Última intervención En proceso o No solucionado" />
              <Metric label="Cerradas técnicamente" value={dashboard.tickets.closed} />
              <Metric label="Pendientes de verificación" value={dashboard.tickets.pending_verification} />
              <Metric label="Reabiertas alguna vez" value={dashboard.tickets.reopened} />
            </ul>
          </section>

          <section aria-labelledby="metrics-cycles">
            <h2 id="metrics-cycles" className="section-title">
              Verificación (por ciclo de atención) e intervenciones
            </h2>
            <ul className="metric-grid">
              <Metric label="Conformes" value={dashboard.cycles.conforming} />
              <Metric label="No conformes" value={dashboard.cycles.not_conforming} />
              <Metric label="Reaperturas" value={dashboard.cycles.reopenings} />
              <Metric label="Intervenciones registradas" value={dashboard.interventions.total} />
              <Metric
                label="Promedio hasta la primera intervención"
                value={hours(dashboard.times.avg_hours_to_first_intervention)}
                hint={`${dashboard.times.tickets_with_intervention} incidencias con intervención`}
              />
              <Metric
                label="Promedio hasta el cierre técnico"
                value={hours(dashboard.times.avg_hours_to_closure)}
                hint={`${dashboard.times.closed_tickets_measured} incidencias cerradas`}
              />
            </ul>
            <p className="field__hint">
              Tiempos promedio observados desde el registro. No hay plazos de atención (SLA)
              definidos.
            </p>
          </section>

          <div className="breakdown-grid">
            <BreakdownTable title="Por estado" rows={dashboard.by_status} />
            <BreakdownTable title="Por área" rows={dashboard.by_area} />
            <BreakdownTable title="Por prioridad" rows={dashboard.by_priority} />
            <BreakdownTable title="Por UPS / servicio" rows={dashboard.by_care_unit} />
            <BreakdownTable title="Intervenciones por resultado" rows={dashboard.interventions.by_result} />
          </div>
        </>
      )}

      {mode === 'reports' && (
      <section className="detail-card" aria-labelledby="reports-title">
        <h2 id="reports-title" className="detail-card__title">
          Reportes Excel
        </h2>
        <p className="field__hint">
          Usan los filtros aplicados. Hasta {options.max_rows.toLocaleString('es-PE')} filas por
          descarga. Cada descarga queda registrada en la auditoría.
        </p>
        {notice && (
          <Alert tone={notice.tone} live="polite">
            {notice.text}
          </Alert>
        )}
        <ul className="report-list">
          {options.reports.map((report) => (
            <li key={report.code} className="report-list__item">
              <span>{report.label}</span>
              <Button
                variant="secondary"
                loading={downloading === report.code}
                loadingText="Generando…"
                disabled={downloading !== null}
                onClick={() => void download(report.code, report.label)}
                aria-label={`Descargar ${report.label} en Excel`}
              >
                Descargar .xlsx
              </Button>
            </li>
          ))}
        </ul>
      </section>
      )}
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <li className="metric">
      <span className="metric__value">{value}</span>
      <span className="metric__label">{label}</span>
      {hint && <span className="metric__hint">{hint}</span>}
    </li>
  )
}

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <section className="detail-card breakdown">
      <h3 className="detail-card__title">{title}</h3>
      {rows.length === 0 ? (
        <p className="muted">Sin datos en el rango.</p>
      ) : (
        <table className="breakdown__table">
          <caption className="visually-hidden">{title}</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.key}-${row.label}`}>
                <th scope="row">{row.label}</th>
                <td>{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
