import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import {
  attentionIncidentPath,
  PATHS,
  planningIncidentPath,
  verificationIncidentPath,
} from '../../shared/paths'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import { useCurrentUser } from '../auth/useAuth'
import { StatusBadge } from '../incidents/StatusBadge'
import { canAccess, hasAnyFeature, isAdminOnly } from '../navigation/access'
import { fetchHomeSummary, type HomeSummary, type TodoItem } from './homeApi'

const ACTIONS: Record<TodoItem['action'], { label: string; verb: string }> = {
  attend: { label: 'Atención asignada', verb: 'Atender' },
  verify: { label: 'Cierre por verificar', verb: 'Verificar' },
  plan: { label: 'Por programar', verb: 'Planificar' },
  follow_up: { label: 'Atención pendiente', verb: 'Revisar' },
}

function todoPath(item: TodoItem): string {
  if (item.action === 'attend') return attentionIncidentPath(item.code)
  if (item.action === 'verify') return verificationIncidentPath(item.code)
  return planningIncidentPath(item.code)
}

/**
 * Inicio (ADR 0010): dashboard operativo personal. No repite el menú: muestra
 * indicadores y lo que requiere atención, solo con lo que la persona puede hacer en sus
 * áreas. Una cuenta exclusivamente administrativa va al
 * Dashboard general.
 */
export function HomePage() {
  useDocumentTitle('Inicio')
  const user = useCurrentUser()
  const adminOnly = isAdminOnly(user)
  const enabled = !adminOnly && hasAnyFeature(user)
  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetchHomeSummary(controller.signal)
      .then((data) => {
        setSummary(data)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'No se pudo cargar el resumen.')
      })
    return () => controller.abort()
  }, [enabled, attempt])

  // Al volver a la pestaña se actualiza en segundo plano (no cuenta como actividad).
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      fetchHomeSummary(controller.signal, true)
        .then(setSummary)
        .catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  if (adminOnly) return <Navigate to={PATHS.admin} replace />

  const operations = canAccess(user, 'attention') || canAccess(user, 'planning') || canAccess(user, 'verifications')

  return (
    <div className="stack">
      <header className="page__header page__header--with-action">
        <div>
          <h1 className="page__title">Hola, {user.first_name || user.full_name}</h1>
          <p className="page__lead">
            {enabled
              ? 'Resumen de tu trabajo en el sistema. Las funciones están en el menú.'
              : 'Tu cuenta todavía no tiene funciones disponibles.'}
          </p>
        </div>
        {canAccess(user, 'incidents') && (
          <Link to={PATHS.newIncident} className="btn btn--secondary">
            Registrar incidencia
          </Link>
        )}
      </header>

      {!enabled ? (
        <Alert tone="info" title="Tu cuenta todavía no tiene funciones asignadas">
          Contacta al administrador del sistema para que habilite las funciones que
          corresponden a tu trabajo.
        </Alert>
      ) : error ? (
        <>
          <Alert tone="danger" title="No se pudo cargar el resumen" live="assertive">
            {error}
          </Alert>
          <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
        </>
      ) : !summary ? (
        <LoadingState label="Cargando resumen…" />
      ) : (
        <>
          <Indicators summary={summary} />
          {operations && <TodoList todo={summary.todo} />}
        </>
      )}
    </div>
  )
}

function Indicators({ summary }: { summary: HomeSummary }) {
  const own = summary.own
  const ownOpen = own ? own.by_status.filter((row) => row.key !== 'cerrada').reduce((sum, row) => sum + row.total, 0) : 0
  return (
    <section aria-labelledby="home-indicators">
      <h2 id="home-indicators" className="section-title">
        Resumen
      </h2>
      <ul className="metric-grid home-metrics">
        {summary.attention && (
          <Indicator
            value={summary.attention.assigned}
            label="Atenciones asignadas"
            hint="Por atender"
            to={PATHS.attention}
          />
        )}
        {summary.planning && (
          <>
            <Indicator
              value={summary.planning.to_schedule}
              label="Por programar"
              hint="Registradas o reabiertas en tus áreas"
              to={PATHS.planning}
            />
            <Indicator
              value={summary.planning.follow_up}
              label="Con atención pendiente"
              hint="Última intervención En proceso o No solucionado"
              to={`${PATHS.planning}?queue=pending`}
            />
          </>
        )}
        {summary.verification && (
          <Indicator
            value={summary.verification.pending}
            label="Cierres por verificar"
            hint="De otras personas, en tus áreas"
            to={PATHS.verifications}
          />
        )}
        {own && (
          <Indicator
            value={ownOpen}
            label="Mis incidencias abiertas"
            hint={`${own.total} registradas en total`}
            to={PATHS.myIncidents}
          />
        )}
      </ul>
      {own && own.total > 0 && (
        <ul className="status-summary" aria-label="Mis incidencias por estado">
          {own.by_status.map((row) => (
            <li key={row.key}>
              <StatusBadge status={row.key} label={row.label} />
              <span className="status-summary__total">{row.total}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Indicator({ value, label, hint, to }: { value: number; label: string; hint: string; to: string }) {
  return (
    <li>
      <Link to={to} className="metric metric--link" aria-label={`${label}: ${value}`}>
        <span className="metric__value">{value}</span>
        <span className="metric__label">{label}</span>
        <span className="metric__hint">{hint}</span>
      </Link>
    </li>
  )
}

function TodoList({ todo }: { todo: HomeSummary['todo'] }) {
  return (
    <section aria-labelledby="home-todo">
      <h2 id="home-todo" className="section-title">
        Requiere tu atención
      </h2>
      {todo.total === 0 ? (
        <p className="muted">No tienes actividades pendientes.</p>
      ) : (
        <>
          {todo.total > todo.items.length && (
            <p className="muted" role="status">
              Se muestran {todo.items.length} de {todo.total}. Consulta el resto en cada sección
              del menú.
            </p>
          )}
          <table className="data-table planning-table">
            <caption className="visually-hidden">Actividades que requieren tu atención</caption>
            <thead>
              <tr>
                <th scope="col">Ticket</th>
                <th scope="col">Pendiente</th>
                <th scope="col">Estado</th>
                <th scope="col">Fecha</th>
                <th scope="col">
                  <span className="visually-hidden">Acción</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {todo.items.map((item) => (
                <tr key={item.code}>
                  <th scope="row" data-label="Ticket">
                    <span className="data-table__code">{item.code}</span>
                    <span className="planning-table__meta">
                      {item.care_unit} · {item.area_name}
                    </span>
                  </th>
                  <td data-label="Pendiente">{ACTIONS[item.action].label}</td>
                  <td data-label="Estado">
                    <StatusBadge status={item.status} label={item.status_label} />
                  </td>
                  <td data-label="Fecha">
                    {item.date ? `${item.date_label}: ${formatDateTime(item.date)}` : '—'}
                  </td>
                  <td data-label="Acción">
                    <Link
                      to={todoPath(item)}
                      className="btn btn--secondary planning-table__action"
                      aria-label={`${ACTIONS[item.action].verb} ${item.code}`}
                    >
                      {ACTIONS[item.action].verb}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
