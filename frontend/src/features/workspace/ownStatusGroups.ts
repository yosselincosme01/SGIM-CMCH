import type { HomeSummary } from './homeApi'

/**
 * Agrupa los estados reales de las incidencias propias en tres indicadores, sin
 * duplicados (cada incidencia está en un solo estado):
 * - Pendientes: registradas o reabiertas (esperan que el área programe la atención).
 * - En atención: asignadas (atención programada, en curso o con seguimiento pendiente).
 * - Cerradas: con cierre técnico vigente.
 */
export function groupOwnStatuses(own: NonNullable<HomeSummary['own']>) {
  const count = (key: string) => own.by_status.find((row) => row.key === key)?.total ?? 0
  return {
    pending: count('registrada') + count('reabierta'),
    inAttention: count('asignada'),
    closed: count('cerrada'),
  }
}
