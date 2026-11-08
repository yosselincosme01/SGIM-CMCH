import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { MetricsPanel } from '../reports/MetricsPanel'
import { PlanningBreadcrumb } from './PlanningParts'

/** Indicadores y reportes del Planificador: solo de sus áreas autorizadas (lo aplica el backend). */
export function PlannerMetricsPage() {
  useDocumentTitle('Indicadores · Planificador')
  return (
    <div className="stack">
      <PlanningBreadcrumb current="Indicadores y reportes" />
      <header className="page__header">
        <p className="page__eyebrow">Planificador</p>
        <h1 className="page__title">Indicadores y reportes</h1>
        <p className="page__lead">Información de las áreas que tienes autorizadas.</p>
      </header>
      <MetricsPanel />
    </div>
  )
}
