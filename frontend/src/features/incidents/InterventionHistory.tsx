import type { Intervention } from './api'
import { formatDateTime } from './validation'

/**
 * Historial técnico de una incidencia (solo personal del área). Las intervenciones no
 * se editan ni se borran: cada atención aparece con su resultado, su evidencia y, si
 * cerró el ticket, su verificación.
 */
export function InterventionHistory({ interventions }: { interventions: Intervention[] }) {
  return (
    <section className="detail-card" aria-labelledby="detail-interventions">
      <h2 id="detail-interventions" className="detail-card__title">
        Intervenciones técnicas
      </h2>
      {interventions.length === 0 ? (
        <p className="muted">Todavía no se registraron intervenciones.</p>
      ) : (
        <ol className="intervention-list">
          {interventions.map((item, index) => (
            <li key={item.id} className="intervention">
              <div className="intervention__header">
                <span className="intervention__number">Intervención {index + 1}</span>
                <span className={`result-badge result-badge--${item.result}`}>
                  {item.result_label}
                </span>
              </div>
              <p className="intervention__meta">
                {formatDateTime(item.created_at)} · {item.technician.full_name}
              </p>
              <dl className="detail-grid">
                <div className="detail-grid__wide">
                  <dt>Diagnóstico técnico</dt>
                  <dd className="preserve-lines">{item.diagnosis}</dd>
                </div>
                <div className="detail-grid__wide">
                  <dt>Acciones realizadas</dt>
                  <dd className="preserve-lines">{item.actions_taken}</dd>
                </div>
                <div>
                  <dt>Repuestos utilizados</dt>
                  <dd className="preserve-lines">
                    {item.used_parts ? item.used_parts_detail : 'No'}
                  </dd>
                </div>
                <div>
                  <dt>Repuestos requeridos</dt>
                  <dd className="preserve-lines">
                    {item.parts_required ? item.parts_required_detail : 'No'}
                  </dd>
                </div>
                {item.unresolved_reason && (
                  <div className="detail-grid__wide">
                    <dt>Motivo</dt>
                    <dd className="preserve-lines">{item.unresolved_reason}</dd>
                  </div>
                )}
                {item.observations && (
                  <div className="detail-grid__wide">
                    <dt>Observaciones</dt>
                    <dd className="preserve-lines">{item.observations}</dd>
                  </div>
                )}
              </dl>
              {item.photos === undefined && (item.photo_count ?? 0) > 0 && (
                <p className="muted">
                  {item.photo_count === 1
                    ? '1 fotografía de evidencia (no disponible en esta consulta).'
                    : `${item.photo_count} fotografías de evidencia (no disponibles en esta consulta).`}
                </p>
              )}
              {item.photos && item.photos.length > 0 && (
                <ul className="intervention__photos" aria-label="Evidencia de la intervención">
                  {item.photos.map((photo) => (
                    <li key={photo.id}>
                      <a href={photo.url} target="_blank" rel="noopener noreferrer">
                        <img
                          src={photo.url}
                          alt={`Evidencia de la intervención ${index + 1}`}
                          width={photo.width}
                          height={photo.height}
                          loading="lazy"
                          className="intervention__photo"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {item.is_closure && (
                <p className="intervention__closure">
                  Cierre técnico.{' '}
                  {item.verification ? (
                    <>
                      Verificación: <strong>{item.verification.result_label}</strong> por{' '}
                      {item.verification.verified_by.full_name} el{' '}
                      {formatDateTime(item.verification.created_at)}
                      {item.verification.observations && <>: {item.verification.observations}</>}
                    </>
                  ) : (
                    'Pendiente de verificación.'
                  )}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
