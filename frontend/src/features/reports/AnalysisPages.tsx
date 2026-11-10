import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { useCurrentUser } from '../auth/useAuth'
import { isAdministrator } from '../navigation/access'
import { MetricsPanel } from './MetricsPanel'

/** Indicadores del Responsable de Área: solo de sus áreas (el alcance lo aplica el backend). */
export function IndicatorsPage() {
  useDocumentTitle('Indicadores')
  return (
    <div className="stack">
      <header className="page__header">
        <p className="page__eyebrow">Análisis</p>
        <h1 className="page__title">Indicadores</h1>
        <p className="page__lead">Información de las áreas que planificas.</p>
      </header>
      <MetricsPanel mode="indicators" />
    </div>
  )
}

/** Reportes Excel: el Administrador, de todas las áreas; el Responsable de Área, de las suyas. */
export function ReportsPage() {
  useDocumentTitle('Reportes')
  const user = useCurrentUser()
  return (
    <div className="stack">
      <header className="page__header">
        <p className="page__eyebrow">Análisis</p>
        <h1 className="page__title">Reportes</h1>
        <p className="page__lead">
          {isAdministrator(user)
            ? 'Descarga reportes en Excel de todas las áreas.'
            : 'Descarga reportes en Excel de las áreas que planificas.'}
        </p>
      </header>
      <MetricsPanel mode="reports" />
    </div>
  )
}
