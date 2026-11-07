/**
 * Identificación del equipo mediante QR (ADR 0005). Solo orienta al usuario: el
 * backend y PostgreSQL vuelven a exigir las mismas reglas.
 *
 * La interfaz presenta dos opciones principales:
 * - "Escanear QR" (o escribirlo): estado `qr_readable`, con contenido obligatorio.
 * - "No tiene QR / No aplica": se elige el motivo (`qr_unreadable`, `no_qr` o
 *   `not_equipment`) y la fotografía pasa a ser obligatoria.
 *
 * No se asume ningún formato de QR ni se interpreta su contenido, y nunca se abre
 * como enlace, aunque sea una URL.
 */
export type EquipmentQrStatus = 'qr_readable' | 'qr_unreadable' | 'no_qr' | 'not_equipment'
export type NoQrReason = Exclude<EquipmentQrStatus, 'qr_readable'>
export type EquipmentMode = 'qr' | 'none'

/** Forma de captura declarada: `scan` solo cuando el texto lo leyó la cámara. */
export type QrCaptureMethod = 'manual' | 'scan'

export const QR_CODE_MAX = 255

export const NO_QR_REASONS: readonly { value: NoQrReason; label: string }[] = [
  { value: 'qr_unreadable', label: 'Tiene QR, pero no puedo leerlo' },
  { value: 'no_qr', label: 'El equipo no tiene QR' },
  { value: 'not_equipment', label: 'No corresponde a un equipo' },
]

export const MESSAGES = {
  modeRequired: 'Indica si el equipo tiene código QR.',
  reasonRequired: 'Selecciona el motivo.',
  qrRequired: 'Escribe o escanea el contenido del código QR.',
  qrTooLong: `El contenido del QR no puede superar ${QR_CODE_MAX} caracteres.`,
  qrInvalid: 'El contenido del QR tiene caracteres no permitidos (saltos de línea o de control).',
  photoRequired:
    'Adjunta una fotografía de la incidencia: es obligatoria cuando no hay un QR legible.',
} as const

export function statusFor(mode: EquipmentMode | '', reason: NoQrReason | ''): EquipmentQrStatus | '' {
  if (mode === 'qr') return 'qr_readable'
  if (mode === 'none') return reason
  return ''
}

export function requiresPhoto(status: EquipmentQrStatus | ''): boolean {
  return status !== '' && status !== 'qr_readable'
}

// Caracteres de control (saltos de línea, tabulaciones) o de formato invisibles.
const FORBIDDEN = /[\p{Cc}\p{Cf}]/u

export function validateQrCode(qrCode: string): string | undefined {
  const code = qrCode.trim()
  if (!code) return MESSAGES.qrRequired
  if (code.length > QR_CODE_MAX) return MESSAGES.qrTooLong
  if (FORBIDDEN.test(code)) return MESSAGES.qrInvalid
  return undefined
}

export function validateEquipment(
  mode: EquipmentMode | '',
  reason: NoQrReason | '',
  qrCode: string,
): { equipmentMode?: string; noQrReason?: string; qrCode?: string } {
  if (mode === 'qr') {
    const error = validateQrCode(qrCode)
    return error ? { qrCode: error } : {}
  }
  if (mode === 'none') return reason ? {} : { noQrReason: MESSAGES.reasonRequired }
  return { equipmentMode: MESSAGES.modeRequired }
}
