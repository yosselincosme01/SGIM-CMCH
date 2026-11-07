/**
 * Identificación del equipo mediante QR (ADR 0005). Solo orienta al usuario: el
 * backend y PostgreSQL vuelven a exigir las mismas reglas.
 *
 * - No se asume ningún formato de QR ni se interpreta su contenido.
 * - El contenido nunca se abre como enlace, aunque sea una URL.
 */
export type EquipmentQrStatus = 'qr_readable' | 'qr_unreadable' | 'no_qr' | 'not_equipment'

/** Forma de captura. Hoy solo existe la manual; la cámara llegará más adelante. */
export type QrCaptureMethod = 'manual' | 'scan'

export const QR_CODE_MAX = 255

export const EQUIPMENT_QR_OPTIONS: readonly {
  value: EquipmentQrStatus
  label: string
  hint: string
}[] = [
  {
    value: 'qr_readable',
    label: 'Tiene QR y puedo leerlo',
    hint: 'Escribirás el contenido que aparece en la etiqueta.',
  },
  {
    value: 'qr_unreadable',
    label: 'Tiene QR, pero no puedo leerlo',
    hint: 'Por ejemplo, si la etiqueta está deteriorada o borrosa.',
  },
  {
    value: 'no_qr',
    label: 'El equipo no tiene QR',
    hint: 'El equipo no tiene ninguna etiqueta QR.',
  },
  {
    value: 'not_equipment',
    label: 'No corresponde a un equipo',
    hint: 'Infraestructura o instalaciones: puertas, iluminación, agua, mobiliario.',
  },
]

// Caracteres de control (saltos de línea, tabulaciones) o de formato invisibles.
const FORBIDDEN = /[\p{Cc}\p{Cf}]/u

export function validateEquipment(status: string, qrCode: string) {
  const errors: { equipmentQrStatus?: string; qrCode?: string } = {}
  if (!EQUIPMENT_QR_OPTIONS.some((option) => option.value === status)) {
    errors.equipmentQrStatus = 'Indica si el equipo tiene código QR.'
    return errors
  }
  if (status !== 'qr_readable') return errors
  const code = qrCode.trim()
  if (!code) errors.qrCode = 'Escribe el contenido del código QR.'
  else if (code.length > QR_CODE_MAX)
    errors.qrCode = `El contenido del QR no puede superar ${QR_CODE_MAX} caracteres.`
  else if (FORBIDDEN.test(code))
    errors.qrCode =
      'El contenido del QR tiene caracteres no permitidos (saltos de línea o de control).'
  return errors
}
