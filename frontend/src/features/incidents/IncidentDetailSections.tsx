import type { IncidentDetail, IncidentEvent } from './api'
import { describeEventChange } from './eventChanges'
import { formatBytes, formatDateTime } from './validation'

/**
 * Secciones del detalle de una incidencia, compartidas por la vista del solicitante
 * la del personal del área y la consulta del Administrador. El contenido depende de lo que envía el backend: el
 * solicitante nunca recibe datos internos de planificación.
 */
export function IncidentSummaryCard({ incident }: { incident: IncidentDetail }) {
  return (
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
          <dt>Identificación del equipo</dt>
          <dd>{incident.equipment_qr_status_label}</dd>
        </div>
        {incident.qr_code && (
          <div className="detail-grid__wide">
            <dt>Contenido del QR</dt>
            {/* Siempre como texto: aunque sea una URL, no se convierte en enlace ni se abre. */}
            <dd className="qr-code" data-testid="qr-code">
              {incident.qr_code}
            </dd>
          </div>
        )}
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
  )
}

export function IncidentEvidence({ incident }: { incident: IncidentDetail }) {
  return (
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
  )
}

export function IncidentHistory({ events }: { events: IncidentEvent[] }) {
  return (
    <section className="detail-card" aria-labelledby="detail-history">
      <h2 id="detail-history" className="detail-card__title">
        Historial
      </h2>
      <ol className="timeline">
        {events.map((event, index) => {
          const changes = describeEventChange(event)
          return (
            <li key={`${event.event_type}-${index}`} className="timeline__item">
              <span className="timeline__label">{event.label}</span>
              <span className="timeline__meta">
                {formatDateTime(event.created_at)} · {event.actor}
              </span>
              {changes.length > 0 && (
                <ul className="timeline__changes">
                  {changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
