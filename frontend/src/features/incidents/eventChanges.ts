import type { IncidentEvent } from './api'
import { formatDateTime } from './validation'

type Named = { name?: string; full_name?: string } | null | undefined

function nameOf(value: unknown, fallback: string): string {
  const named = value as Named
  return named?.full_name ?? named?.name ?? fallback
}

function dateOf(value: unknown): string {
  return typeof value === 'string' ? formatDateTime(value) : 'Sin fecha'
}

/** Qué cambió, con los valores anteriores y nuevos (solo para el personal del área). */
export function describeEventChange(event: IncidentEvent): string[] {
  const details = event.details
  if (!details) return []
  const reason = typeof details.reason === 'string' && details.reason ? details.reason : null
  const lines: string[] = []
  switch (event.event_type) {
    case 'priority_changed':
      lines.push(
        `Prioridad: ${nameOf(details.from, 'Sin prioridad')} → ${nameOf(details.to, 'Sin prioridad')}`,
      )
      break
    case 'assigned':
      lines.push(`Técnico responsable: ${nameOf(details.technician, 'No indicado')}`)
      lines.push(`Fecha estimada: ${dateOf(details.scheduled_at)}`)
      break
    case 'technician_changed':
      lines.push(
        `Técnico responsable: ${nameOf(details.from, 'No indicado')} → ${nameOf(details.to, 'No indicado')}`,
      )
      break
    case 'schedule_changed':
      lines.push(`Fecha estimada: ${dateOf(details.from)} → ${dateOf(details.to)}`)
      break
    default:
      break
  }
  if (reason) lines.push(`Motivo: ${reason}`)
  return lines
}
