import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { LoadingState } from '../../shared/ui/LoadingState'
import { fetchIncident, type IncidentDetail, type PriorityLevel } from '../incidents/api'
import {
  IncidentEvidence,
  IncidentHistory,
  IncidentSummaryCard,
} from '../incidents/IncidentDetailSections'
import { StatusBadge } from '../incidents/StatusBadge'
import { fetchPlanningOptions, fetchTechnicians, type Technician } from './api'
import { InterventionHistory } from '../incidents/InterventionHistory'
import { ClosurePanel } from './ClosurePanel'
import { PlanningPanel } from './PlanningPanel'
import { type PlanningMode, sectionLabel, sectionPath } from './paths'
import { PlanningBreadcrumb, PriorityBadge } from './PlanningParts'

interface Loaded {
  detail: IncidentDetail
  priorities: PriorityLevel[]
  technicians: Technician[]
}

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready' }

/**
 * Detalle de una incidencia del área, compartido por Planificación y Verificaciones
 * (ADR 0009). En Verificaciones solo se muestra el panel del cierre técnico; las
 * acciones disponibles las indica siempre el backend (``permissions``).
 */
export function PlanningDetailPage({ mode = 'plan' }: { mode?: PlanningMode }) {
  const { code = '' } = useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [incident, setIncident] = useState<IncidentDetail | null>(null)
  const [priorities, setPriorities] = useState<PriorityLevel[]>([])
  const [technicians, setTechnicians] = useState<Technician[] | null>(null)
  const [blocked, setBlocked] = useState(false)
  useDocumentTitle(incident ? `${incident.code} · ${sectionLabel(mode)}` : sectionLabel(mode))

  const fetchAll = useCallback(
    async (signal?: AbortSignal): Promise<Loaded> => {
      const [detail, options] = await Promise.all([
        fetchIncident(code, signal),
        fetchPlanningOptions(signal),
      ])
      const staff = mode === 'plan' && detail.permissions?.can_plan
        ? (await fetchTechnicians(detail.code, signal)).results
        : []
      return { detail, priorities: options.priorities, technicians: staff }
    },
    [code, mode],
  )

  function apply(loaded: Loaded): IncidentDetail {
    setIncident(loaded.detail)
    setPriorities(loaded.priorities)
    setTechnicians(loaded.technicians)
    setState({ status: 'ready' })
    return loaded.detail
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchAll(controller.signal)
      .then((loaded) => {
        setIncident(loaded.detail)
        setPriorities(loaded.priorities)
        setTechnicians(loaded.technicians)
        setState({ status: 'ready' })
      })
      .catch((error: unknown) => {
      if (controller.signal.aborted) return
      if (!isApiError(error) || error.status === 404) setState({ status: 'not-found' })
      else setState({ status: 'error', message: error.message })
    })
    return () => controller.abort()
  }, [fetchAll])

  if (state.status === 'loading') return <LoadingState label="Cargando incidencia…" />

  if (state.status !== 'ready' || !incident) {
    return (
      <div className="stack">
        <PlanningBreadcrumb current="Detalle" mode={mode} />
        <Alert
          tone={state.status === 'not-found' ? 'warning' : 'danger'}
          title={
            state.status === 'not-found'
              ? 'No encontramos esta incidencia'
              : 'No se pudo cargar la incidencia'
          }
          live="assertive"
        >
          {state.status === 'not-found'
            ? 'El código no existe o la incidencia no pertenece a tus áreas autorizadas.'
            : state.status === 'error'
              ? state.message
              : ''}
        </Alert>
        <p>
          <Link to={sectionPath(mode)} className="btn btn--secondary">
            Volver a {sectionLabel(mode)}
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="stack" inert={blocked} aria-hidden={blocked || undefined}>
      <PlanningBreadcrumb current={incident.code} mode={mode} />
      <header className="page__header page__header--with-action">
        <div>
          <p className="page__eyebrow">
            {sectionLabel(mode)} · {incident.support_area.name}
          </p>
          <h1 className="page__title">
            {incident.code}
          </h1>
          <p className="page__lead">Registrada el {formatDateTime(incident.created_at)}</p>
        </div>
        <div className="planning-header__badges">
          <PriorityBadge priority={incident.priority} />
          <StatusBadge status={incident.status} label={incident.status_label} />
        </div>
      </header>

      <div className="planning-layout">
        <aside className="planning-layout__panel" aria-label={sectionLabel(mode)}>
          {mode === 'verify' && incident.status !== 'cerrada' ? (
            <section className="detail-card">
              <h2 className="detail-card__title">Sin cierre técnico vigente</h2>
              <p className="muted">
                Esta incidencia no tiene un cierre técnico pendiente de verificación. Su estado
                actual es «{incident.status_label}».
              </p>
            </section>
          ) : incident.status === 'cerrada' ? (
            <ClosurePanel
              incident={incident}
              onSaved={(updated) => {
                setIncident(updated)
                // Tras reabrir, se vuelve a programar: hace falta la lista de técnicos.
                if (updated.permissions?.can_plan) {
                  fetchTechnicians(updated.code)
                    .then((result) => setTechnicians(result.results))
                    .catch(() => {})
                }
              }}
              onReload={() => {
                fetchAll().then(apply).catch(() => {})
              }}
            />
          ) : (
          <PlanningPanel
            incident={incident}
            priorities={priorities}
            technicians={technicians ?? []}
            onSaved={(updated) => {
              setIncident(updated)
              // La carga de los técnicos cambió: se actualiza sin bloquear la pantalla.
              fetchTechnicians(updated.code)
                .then((result) => setTechnicians(result.results))
                .catch(() => {})
            }}
            onReload={() => fetchAll().then(apply)}
            onDialogChange={setBlocked}
          />
          )}
        </aside>
        <div className="planning-layout__main stack">
          <IncidentSummaryCard incident={incident} />
          <IncidentEvidence incident={incident} />
          <InterventionHistory interventions={incident.interventions ?? []} />
          <IncidentHistory events={incident.events} />
        </div>
      </div>

      <p>
        <Link to={sectionPath(mode)} className="btn btn--secondary">
          Volver a {sectionLabel(mode)}
        </Link>
      </p>
    </div>
  )
}
