import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { LoadingState } from '../../shared/ui/LoadingState'
import { fetchIncident, type IncidentDetail } from './api'
import { IncidentBreadcrumb } from './IncidentBreadcrumb'
import { IncidentEvidence, IncidentHistory, IncidentSummaryCard } from './IncidentDetailSections'
import { StatusBadge } from './StatusBadge'
import { formatDateTime } from './validation'

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; incident: IncidentDetail }

/** Detalle de una incidencia propia (vista Solicitante). */
export function IncidentDetailPage() {
  const { code = '' } = useParams()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  useDocumentTitle(state.status === 'ready' ? state.incident.code : 'Detalle de incidencia')

  useEffect(() => {
    const controller = new AbortController()
    fetchIncident(code, controller.signal)
      .then((incident) => setState({ status: 'ready', incident }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (!isApiError(error) || error.status === 404) setState({ status: 'not-found' })
        else setState({ status: 'error', message: error.message })
      })
    return () => controller.abort()
  }, [code])

  if (state.status === 'loading') return <LoadingState label="Cargando incidencia…" />

  if (state.status !== 'ready') {
    return (
      <div className="stack">
        <IncidentBreadcrumb current="Detalle" throughList />
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
            ? 'El código no existe o no tienes acceso a esta incidencia.'
            : state.message}
        </Alert>
        <p>
          <Link to="/solicitante/incidencias" className="btn btn--secondary">
            Volver a mis incidencias
          </Link>
        </p>
      </div>
    )
  }

  const { incident } = state
  return (
    <div className="stack">
      <IncidentBreadcrumb current={incident.code} throughList />
      <header className="page__header page__header--with-action">
        <div>
          <p className="page__eyebrow">Incidencia</p>
          <h1 className="page__title">{incident.code}</h1>
          <p className="page__lead">Registrada el {formatDateTime(incident.created_at)}</p>
        </div>
        <StatusBadge status={incident.status} label={incident.status_label} />
      </header>

      {incident.closed_at && (
        <section className="detail-card schedule-note" aria-labelledby="detail-closed">
          <h2 id="detail-closed" className="detail-card__title">
            Atención finalizada
          </h2>
          <p>
            El área de soporte cerró la incidencia el{' '}
            <strong>{formatDateTime(incident.closed_at)}</strong> (hora de Lima).
          </p>
        </section>
      )}

      {!incident.closed_at && incident.scheduled_at && (
        <section className="detail-card schedule-note" aria-labelledby="detail-schedule">
          <h2 id="detail-schedule" className="detail-card__title">
            Atención programada
          </h2>
          <p>
            Fecha estimada de atención:{' '}
            <strong data-testid="scheduled-at">{formatDateTime(incident.scheduled_at)}</strong>{' '}
            (hora de Lima)
          </p>
          <p className="muted">La fecha es estimada y el área de soporte puede reprogramarla.</p>
        </section>
      )}

      <IncidentSummaryCard incident={incident} />
      <IncidentEvidence incident={incident} />
      <IncidentHistory events={incident.events} />

      <p>
        <Link to="/solicitante/incidencias" className="btn btn--secondary">
          Volver a mis incidencias
        </Link>
      </p>
    </div>
  )
}
