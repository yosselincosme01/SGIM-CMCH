import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { LoadingState } from '../../shared/ui/LoadingState'
import { fetchIncident, type IncidentDetail } from '../incidents/api'
import {
  IncidentEvidence,
  IncidentHistory,
  IncidentSummaryCard,
} from '../incidents/IncidentDetailSections'
import { InterventionHistory } from '../incidents/InterventionHistory'
import { StatusBadge } from '../incidents/StatusBadge'
import { PriorityBadge } from '../planning/PlanningParts'
import { ATTENTION_PATH } from './AttentionInboxPage'
import { InterventionForm } from './InterventionForm'

type LoadState = 'loading' | 'not-found' | 'ready' | { error: string }

/** Detalle de una incidencia asignada: datos, historial técnico y registro de intervención. */
export function AttentionDetailPage() {
  const { code = '' } = useParams()
  const [state, setState] = useState<LoadState>('loading')
  const [incident, setIncident] = useState<IncidentDetail | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useDocumentTitle(incident ? `${incident.code} · Atención` : 'Atender incidencia')

  const load = useCallback((signal?: AbortSignal) => fetchIncident(code, signal), [code])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
      .then((detail) => {
        setIncident(detail)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState(!isApiError(error) || error.status === 404 ? 'not-found' : { error: error.message })
      })
    return () => controller.abort()
  }, [load])

  if (state === 'loading') return <LoadingState label="Cargando incidencia…" />
  if (state !== 'ready' || !incident) {
    return (
      <div className="stack">
        <Alert tone={state === 'not-found' ? 'warning' : 'danger'} title="No se pudo abrir la incidencia" live="assertive">
          {state === 'not-found'
            ? 'El código no existe o la incidencia no pertenece a tus áreas autorizadas.'
            : typeof state === 'object'
              ? state.error
              : ''}
        </Alert>
        <p>
          <Link to={ATTENTION_PATH} className="btn btn--secondary">
            Volver a la bandeja
          </Link>
        </p>
      </div>
    )
  }

  const canIntervene = incident.permissions?.can_intervene === true
  const assignment = incident.assignment

  return (
    <div className="stack">
      <nav aria-label="Ruta de navegación" className="breadcrumb">
        <ol>
          <li>
            <Link to="/">Inicio</Link>
          </li>
          <li>
            <Link to={ATTENTION_PATH}>Personal de Atención</Link>
          </li>
          <li aria-current="page">{incident.code}</li>
        </ol>
      </nav>
      <header className="page__header page__header--with-action">
        <div>
          <p className="page__eyebrow">Atención · {incident.support_area.name}</p>
          <h1 className="page__title">{incident.code}</h1>
          <p className="page__lead">Registrada el {formatDateTime(incident.created_at)}</p>
        </div>
        <div className="planning-header__badges">
          <PriorityBadge priority={incident.priority} />
          <StatusBadge status={incident.status} label={incident.status_label} />
        </div>
      </header>

      {notice && (
        <Alert tone="success" live="polite">
          {notice}
        </Alert>
      )}

      <div className="planning-layout">
        <aside className="planning-layout__panel" aria-label="Atención">
          {assignment && (
            <section className="planning-panel" aria-labelledby="attention-assignment">
              <h2 id="attention-assignment" className="planning-panel__title">
                Asignación
              </h2>
              <dl className="current-assignment">
                <div>
                  <dt>Técnico responsable</dt>
                  <dd>{assignment.technician.full_name}</dd>
                </div>
                <div>
                  <dt>Fecha estimada</dt>
                  <dd>{formatDateTime(assignment.scheduled_at)} (hora de Lima)</dd>
                </div>
                {assignment.notes && (
                  <div>
                    <dt>Indicaciones del Planificador</dt>
                    <dd className="preserve-lines">{assignment.notes}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
          {canIntervene ? (
            <InterventionForm
              incident={incident}
              onSaved={(updated) => {
                setIncident(updated)
                setNotice(
                  updated.status === 'cerrada'
                    ? 'Intervención registrada. La incidencia quedó cerrada y pendiente de verificación.'
                    : 'Intervención registrada. La incidencia sigue abierta.',
                )
              }}
              onConflict={() => {
                load().then(setIncident).catch(() => {})
              }}
            />
          ) : (
            <section className="planning-panel">
              <p className="muted">
                {incident.status === 'cerrada'
                  ? `Cerrada el ${incident.closure ? formatDateTime(incident.closure.closed_at) : ''}. No admite nuevas intervenciones salvo que el Planificador la reabra.`
                  : 'No tienes una asignación vigente sobre esta incidencia.'}
              </p>
            </section>
          )}
        </aside>
        <div className="planning-layout__main stack">
          <IncidentSummaryCard incident={incident} />
          <IncidentEvidence incident={incident} />
          <InterventionHistory interventions={incident.interventions ?? []} />
          <IncidentHistory events={incident.events} />
        </div>
      </div>
    </div>
  )
}
