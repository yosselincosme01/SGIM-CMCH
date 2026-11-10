import { PATHS, planningIncidentPath, verificationIncidentPath } from '../../shared/paths'

export const PLANNER_PATH = PATHS.planning

/** Desde qué funcionalidad se abre el detalle (ADR 0009). */
export type PlanningMode = 'plan' | 'verify'

export function plannerIncidentPath(code: string, mode: PlanningMode = 'plan'): string {
  return mode === 'verify' ? verificationIncidentPath(code) : planningIncidentPath(code)
}

export function sectionPath(mode: PlanningMode): string {
  return mode === 'verify' ? PATHS.verifications : PATHS.planning
}

export function sectionLabel(mode: PlanningMode): string {
  return mode === 'verify' ? 'Verificaciones' : 'Planificación'
}
