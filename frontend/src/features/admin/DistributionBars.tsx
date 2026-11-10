/**
 * Distribución de una sola serie en barras horizontales (ADR 0011). Cada fila lleva su
 * etiqueta y su valor en texto, así que el color nunca es la única fuente de
 * información; la lista es también la vista en tabla.
 */
export interface DistributionRow {
  key: string
  label: string
  total: number
}

export function DistributionBars({
  title,
  rows,
  total,
  id,
}: {
  title: string
  rows: DistributionRow[]
  /** Base del porcentaje: el total de incidencias del periodo. */
  total: number
  id: string
}) {
  const max = Math.max(1, ...rows.map((row) => row.total))
  return (
    <section className="detail-card distribution" aria-labelledby={id}>
      <h2 id={id} className="detail-card__title">
        {title}
      </h2>
      {total === 0 ? (
        <p className="muted">Sin incidencias en el periodo.</p>
      ) : (
        <ul className="distribution__list">
          {rows.map((row) => {
            const percent = Math.round((row.total / total) * 100)
            return (
              <li key={row.key} className="distribution__row">
                <span className="distribution__label">{row.label}</span>
                <span className="distribution__track" aria-hidden="true">
                  {row.total > 0 && (
                    <span
                      className="distribution__bar"
                      style={{ width: `${(row.total / max) * 100}%` }}
                    />
                  )}
                </span>
                <span className="distribution__value">
                  {row.total} <span className="distribution__percent">({percent} %)</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
