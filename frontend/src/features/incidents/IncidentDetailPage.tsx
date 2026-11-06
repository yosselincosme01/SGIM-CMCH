import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { LoadingState } from '../../shared/ui/LoadingState'
import { fetchIncident, type IncidentDetail } from './api'
import { IncidentBreadcrumb } from './IncidentBreadcrumb'
import { StatusBadge } from './StatusBadge'
import { formatBytes, formatDateTime } from './validation'

type LoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; incident: IncidentDetail }

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

      <section className="detail-card" aria-labelledby="detail-summary">
        <h2 id="detail-summary" className="detail-card__title">
          Datos de la incidencia
        </h2>
        <dl className="detail-grid">
          <div>
            <dt>UPS / servicio</dt>
            <dd>{incident.care_unit.name}</dd>
          </div>
          <div>
            <dt>Área de soporte</dt>
            <dd>{incident.support_area.name}</dd>
          </div>
          <div>
            <dt>Equipo o activo</dt>
            <dd>{incident.asset_reference || 'No indicado'}</dd>
          </div>
          <div>
            <dt>Registrada por</dt>
            <dd>{incident.created_by.full_name}</dd>
          </div>
          <div className="detail-grid__wide">
            <dt>Descripción del problema</dt>
            <dd className="preserve-lines">{incident.description}</dd>
          </div>
          <div className="detail-grid__wide">
            <dt>Acciones previas</dt>
            <dd className="preserve-lines">{incident.prior_actions || 'No indicadas'}</dd>
          </div>
        </dl>
      </section>

      <section className="detail-card" aria-labelledby="detail-evidence">
        <h2 id="detail-evidence" className="detail-card__title">
          Evidencia
        </h2>
        {incident.attachments.length === 0 ? (
          <p className="muted">No se adjuntaron imágenes.</p>
        ) : (
          <ul className="evidence-list">
            {incident.attachments.map((attachment) => (
              <li key={attachment.id} className="evidence">
                <img
                  src={attachment.url}
                  alt={`Evidencia adjunta a ${incident.code}`}
                  width={attachment.width}
                  height={attachment.height}
                  loading="lazy"
                  className="evidence__image"
                />
                <p className="evidence__meta">
                  {attachment.original_name} · {formatBytes(attachment.size)} ·{' '}
                  <a href={attachment.url} target="_blank" rel="noopener noreferrer">
                    Abrir imagen
                  </a>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-card" aria-labelledby="detail-history">
        <h2 id="detail-history" className="detail-card__title">
          Historial
        </h2>
        <ol className="timeline">
          {incident.events.map((event, index) => (
            <li key={`${event.event_type}-${index}`} className="timeline__item">
              <span className="timeline__label">{event.label}</span>
              <span className="timeline__meta">
                {formatDateTime(event.created_at)} · {event.actor}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p>
        <Link to="/solicitante/incidencias" className="btn btn--secondary">
          Volver a mis incidencias
        </Link>
      </p>
    </div>
  )
}
