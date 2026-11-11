/**
 * Fechas del SGIM: siempre se presentan e interpretan en hora de Lima (America/Lima),
 * sin depender de la zona horaria del navegador ni del sistema operativo.
 *
 * Para programar, el formulario trabaja con "AAAA-MM-DDTHH:mm" en hora de Lima y lo
 * envía sin zona horaria: el backend lo interpreta como hora de Lima.
 */
export const DISPLAY_TIME_ZONE = 'America/Lima'

const dateTimeFormat = new Intl.DateTimeFormat('es-PE', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: DISPLAY_TIME_ZONE,
})

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatDateTime(value: string | Date): string {
  return dateTimeFormat.format(typeof value === 'string' ? new Date(value) : value)
}

function limaParts(value: Date): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const part of partsFormat.formatToParts(value)) parts[part.type] = part.value
  return parts
}

/** Fecha y hora de Lima en el formato de un campo "datetime-local": AAAA-MM-DDTHH:mm. */
export function toLimaInputValue(value: string | Date): string {
  const p = limaParts(typeof value === 'string' ? new Date(value) : value)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

const timeFormat = new Intl.DateTimeFormat('es-PE', {
  timeStyle: 'short',
  timeZone: DISPLAY_TIME_ZONE,
})

/**
 * Fecha breve para listas, en hora de Lima: «Hoy, 9:42 a. m.», «Ayer, 4:18 p. m.» o la
 * fecha completa si es anterior.
 */
export function formatRelativeDay(value: string | Date, now: Date = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const day = toLimaInputValue(date).slice(0, 10)
  const today = limaToday(now)
  const yesterday = limaToday(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  if (day === today) return `Hoy, ${timeFormat.format(date)}`
  if (day === yesterday) return `Ayer, ${timeFormat.format(date)}`
  return formatDateTime(date)
}

/** Fecha de hoy en Lima: AAAA-MM-DD. */
export function limaToday(now: Date = new Date()): string {
  return toLimaInputValue(now).slice(0, 10)
}

const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

export function isValidLocalInput(value: string): boolean {
  if (!LOCAL_INPUT.test(value)) return false
  const date = new Date(`${value}:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/** ¿El valor (hora de Lima) es anterior al minuto actual en Lima? */
export function isPastLimaInput(value: string, now: Date = new Date()): boolean {
  // Mismo formato y longitud: la comparación de textos equivale a la cronológica.
  return value < toLimaInputValue(now)
}
