export const PLANNER_PATH = '/planificador'

export function plannerIncidentPath(code: string): string {
  return `${PLANNER_PATH}/incidencias/${code}`
}
