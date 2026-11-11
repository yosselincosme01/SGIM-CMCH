import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatRelativeDay } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import {
  attentionIncidentPath,
  evaluateSurveyPath,
  myIncidentPath,
  PATHS,
  planningIncidentPath,
  verificationIncidentPath,
} from '../../shared/paths'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import { useCurrentUser } from '../auth/useAuth'
import { fetchMyIncidents, type IncidentSummary } from '../incidents/api'
import { StatusBadge } from '../incidents/StatusBadge'
import { fetchSurveyReminder, type SurveyReminder } from '../incidents/surveyApi'
import { canAccess, hasAnyFeature, isAdminOnly } from '../navigation/access'
import { fetchHomeSummary, type HomeSummary, type TodoItem } from './homeApi'
import { groupOwnStatuses } from './ownStatusGroups'

const RECENT_LIMIT = 5

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
 * Inicio de los trabajadores (ADR 0010, rediseño mobile-first).
 *
 * - Saludo y acción principal «Registrar incidencia».
 * - Resumen de las incidencias propias en tres indicadores.
 * - Encuestas pendientes (solo si existen), conectadas con la encuesta existente.
 * - Trabajo de las áreas (solo con capacidades operativas): lo que requiere atención.
 * - Mis incidencias recientes, con acceso al detalle.
 *
 * Una cuenta exclusivamente administrativa va al Dashboard general.
 */
export function HomePage() {
  useDocumentTitle('Inicio')
  const user = useCurrentUser()
  const adminOnly = isAdminOnly(user)
  const enabled = !adminOnly && hasAnyFeature(user)
  const ownIncidents = canAccess(user, 'incidents')
  const operations =
    canAccess(user, 'attention') || canAccess(user, 'planning') || canAccess(user, 'verifications')
  const [summary, setSummary] = useState<HomeSummary | null>(null)
  const [recent, setRecent] = useState<IncidentSummary[] | null>(null)
  const [surveys, setSurveys] = useState<SurveyReminder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    Promise.all([
      fetchHomeSummary(controller.signal),
      ownIncidents ? fetchMyIncidents(1, controller.signal) : Promise.resolve(null),
    ])
      .then(([data, mine]) => {
        setSummary(data)
        setRecent(mine ? mine.results.slice(0, RECENT_LIMIT) : [])
        setError(null)
        // Ticket de la encuesta pendiente más reciente (consulta pasiva, solo si hay alguna).
        if (data.surveys && data.surveys.pending > 0) {
          fetchSurveyReminder(controller.signal)
            .then(setSurveys)
            .catch(() => {})
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'No se pudo cargar el resumen.')
      })
    return () => controller.abort()
  }, [enabled, ownIncidents, attempt])

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

  return (
    <div className="home">
      <header className="home__header">
        <div>
          <h1 className="home__title">Hola, {user.first_name || user.full_name}</h1>
          <p className="home__lead">
            {enabled ? '¿En qué podemos ayudarte hoy?' : 'Tu cuenta todavía no tiene funciones disponibles.'}
          </p>
        </div>
        {ownIncidents && (
          <Link to={PATHS.newIncident} className="btn home__cta">
            <span>Registrar incidencia</span>
            <span className="home__cta-chevron" aria-hidden="true">
              ›
            </span>
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
      ) : !summary || recent === null ? (
        <LoadingState label="Cargando resumen…" />
      ) : (
        <>
          {summary.own && <OwnSummary own={summary.own} />}
          {summary.surveys && summary.surveys.pending > 0 && (
            <SurveyCard pending={summary.surveys.pending} reminder={surveys} />
          )}
          {operations && <WorkSection summary={summary} />}
          {ownIncidents && <RecentIncidents incidents={recent} />}
        </>
      )}
    </div>
  )
}

function OwnSummary({ own }: { own: NonNullable<HomeSummary['own']> }) {
  const groups = groupOwnStatuses(own)
  return (
    <section className="home__section" aria-labelledby="home-summary">
      <h2 id="home-summary" className="home__section-title">
        Resumen
      </h2>
      <ul className="home-stats" aria-label="Mis incidencias por estado">
        <Stat value={groups.pending} label="Pendientes" />
        <Stat value={groups.inAttention} label="En atención" />
        <Stat value={groups.closed} label="Cerradas" />
      </ul>
    </section>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <li className="home-stat">
      <span className="home-stat__value">{value}</span>
      <span className="home-stat__label">{label}</span>
    </li>
  )
}

function SurveyCard({ pending, reminder }: { pending: number; reminder: SurveyReminder | null }) {
  const latest = reminder?.items[0]
  // Abre la encuesta existente del ticket más reciente; sin el ticket, va a Mis incidencias.
  const target = latest ? evaluateSurveyPath(latest.code) : PATHS.myIncidents
  return (
    <section className="home-survey" aria-labelledby="home-survey">
      <div>
        <h2 id="home-survey" className="home-survey__title">
          {pending === 1 ? 'Tienes 1 encuesta pendiente' : `Tienes ${pending} encuestas pendientes`}
        </h2>
        <p className="home-survey__text">
          {pending === 1
            ? 'Evalúa la atención de una incidencia cerrada.'
            : 'Evalúa la atención de tus incidencias cerradas. Empezamos por la más reciente.'}
        </p>
      </div>
      <Link to={target} className="btn btn--primary home-survey__action">
        Evaluar atención
      </Link>
    </section>
  )
}

function WorkSection({ summary }: { summary: HomeSummary }) {
  const { todo } = summary
  const counts = [
    summary.attention && { label: 'Atenciones asignadas', value: summary.attention.assigned, to: PATHS.attention },
    summary.planning && { label: 'Por programar', value: summary.planning.to_schedule, to: PATHS.planning },
    summary.planning && {
      label: 'Con atención pendiente',
      value: summary.planning.follow_up,
      to: `${PATHS.planning}?queue=pending`,
    },
    summary.verification && {
      label: 'Cierres por verificar',
      value: summary.verification.pending,
      to: PATHS.verifications,
    },
  ].filter(Boolean) as { label: string; value: number; to: string }[]

  return (
    <section className="home__section" aria-labelledby="home-todo">
      <h2 id="home-todo" className="home__section-title">
        Requiere tu atención
      </h2>
      <ul className="home-chips" aria-label="Trabajo de tus áreas">
        {counts.map((item) => (
          <li key={item.label}>
            <Link to={item.to} className="home-chip" aria-label={`${item.label}: ${item.value}`}>
              <span className="home-chip__value">{item.value}</span> {item.label}
            </Link>
          </li>
        ))}
      </ul>
      {todo.total === 0 ? (
        <p className="home-empty">No tienes actividades pendientes.</p>
      ) : (
        <>
          <ul className="home-list" aria-label="Actividades que requieren tu atención">
            {todo.items.map((item) => (
              <li key={item.code}>
                <Link
                  to={todoPath(item)}
                  className="home-item"
                  aria-label={`${ACTIONS[item.action].verb} ${item.code}`}
                >
                  <span className="home-item__code">{item.code}</span>
                  <span className="home-item__main">
                    <span className="home-item__title">{ACTIONS[item.action].label}</span>
                    <span className="home-item__meta">
                      {item.care_unit} · {item.area_name}
                    </span>
                  </span>
                  <span className="home-item__date">
                    {item.date ? `${item.date_label}: ${formatRelativeDay(item.date)}` : '—'}
                  </span>
                  <span className="home-item__status">
                    <StatusBadge status={item.status} label={item.status_label} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {todo.total > todo.items.length && (
            <p className="home-empty" role="status">
              Se muestran {todo.items.length} de {todo.total}. Consulta el resto en cada sección
              del menú.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function RecentIncidents({ incidents }: { incidents: IncidentSummary[] }) {
  return (
    <section className="home__section" aria-labelledby="home-recent">
      <div className="home__section-header">
        <h2 id="home-recent" className="home__section-title">
          Mis incidencias recientes
        </h2>
        {incidents.length > 0 && (
          <Link to={PATHS.myIncidents} className="home__link">
            Ver todas
          </Link>
        )}
      </div>
      {incidents.length === 0 ? (
        <p className="home-empty">
          Aún no has registrado incidencias. Cuando registres una, podrás seguir su estado aquí.
        </p>
      ) : (
        <ul className="home-list" aria-label="Mis incidencias recientes">
          {incidents.map((incident) => (
            <li key={incident.code}>
              <Link to={myIncidentPath(incident.code)} className="home-item">
                <span className="home-item__code">{incident.code}</span>
                <span className="home-item__main">
                  <span className="home-item__title">
                    {incident.description_preview || 'Sin descripción'}
                  </span>
                  <span className="home-item__meta">{incident.support_area.name}</span>
                </span>
                <span className="home-item__date">{formatRelativeDay(incident.created_at)}</span>
                <span className="home-item__status">
                  <StatusBadge status={incident.status} label={incident.status_label} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
