import type { Satisfaction } from './api'

function number(value: number, digits = 1): string {
  return value.toLocaleString('es-PE', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

/**
 * Satisfacción del solicitante (ADR 0012): indicadores discretos, solo cuando hay
 * respuestas. Una encuesta no respondida no cuenta como insatisfacción. Es distinta de
 * la verificación técnica del Responsable de Área.
 */
export function SatisfactionSummary({ data }: { data: Satisfaction | undefined }) {
  if (!data || data.eligible === 0) return null
  return (
    <section className="detail-card satisfaction" aria-labelledby="satisfaction-title">
      <h2 id="satisfaction-title" className="detail-card__title">
        Satisfacción del solicitante
      </h2>
      {data.answered === 0 ? (
        <p className="muted">
          Aún no hay encuestas respondidas en el periodo ({data.pending}{' '}
          {data.pending === 1 ? 'pendiente' : 'pendientes'} de respuesta).
        </p>
      ) : (
        <>
          <dl className="satisfaction__grid">
            <div>
              <dt>Promedio</dt>
              <dd>
                {data.average === null ? '—' : number(data.average, 2)}
                <span className="satisfaction__unit"> / 5</span>
              </dd>
            </div>
            <div>
              <dt>Respondidas</dt>
              <dd>{data.answered}</dd>
            </div>
            <div>
              <dt>Pendientes de respuesta</dt>
              <dd>{data.pending}</dd>
            </div>
            <div>
              <dt>Tasa de respuesta</dt>
              <dd>{data.response_rate === null ? '—' : `${number(data.response_rate)} %`}</dd>
            </div>
          </dl>
          <p className="field__hint">
            Sobre {data.eligible} {data.eligible === 1 ? 'cierre técnico' : 'cierres técnicos'} del
            periodo. Las encuestas no respondidas no se consideran insatisfacción. Es la opinión
            voluntaria del solicitante, distinta de la verificación técnica.
          </p>
        </>
      )}
    </section>
  )
}
