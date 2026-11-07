/**
 * Validación del formulario en el navegador (solo para ayudar al usuario).
 * La validación definitiva —incluido el contenido real de la imagen— la hace el backend.
 */
import type { NewIncident } from './api'
import { MESSAGES, requiresPhoto, statusFor, validateEquipment } from './equipment'

export const DESCRIPTION_MIN = 10
export const DESCRIPTION_MAX = 2000
export const PRIOR_ACTIONS_MAX = 1000
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type IncidentFormErrors = Partial<
  Record<
    | 'careUnit'
    | 'equipmentMode'
    | 'noQrReason'
    | 'qrCode'
    | 'supportArea'
    | 'description'
    | 'priorActions'
    | 'photo',
    string
  >
>

export function validatePhoto(file: File | null): string | undefined {
  if (!file) return undefined
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return 'Usa una fotografía JPG, PNG o WebP.'
  }
  if (file.size > PHOTO_MAX_BYTES) return 'La imagen supera el tamaño máximo de 5 MB.'
  if (file.size === 0) return 'El archivo está vacío.'
  return undefined
}

export function validateIncident(data: NewIncident): IncidentFormErrors {
  const errors: IncidentFormErrors = {}
  const description = data.description.trim()
  if (!data.careUnit) errors.careUnit = 'Selecciona la UPS o servicio.'
  if (!data.supportArea) errors.supportArea = 'Selecciona el área de soporte.'
  if (!description) errors.description = 'Describe el problema.'
  else if (description.length < DESCRIPTION_MIN) {
    errors.description = `La descripción debe tener al menos ${DESCRIPTION_MIN} caracteres.`
  } else if (description.length > DESCRIPTION_MAX) {
    errors.description = `La descripción no puede superar ${DESCRIPTION_MAX} caracteres.`
  }
  if (data.priorActions.trim().length > PRIOR_ACTIONS_MAX) {
    errors.priorActions = `No puede superar ${PRIOR_ACTIONS_MAX} caracteres.`
  }
  Object.assign(errors, validateEquipment(data.equipmentMode, data.noQrReason, data.qrCode))
  const photoError = validatePhoto(data.photo)
  if (photoError) errors.photo = photoError
  else if (!data.photo && requiresPhoto(statusFor(data.equipmentMode, data.noQrReason))) {
    errors.photo = MESSAGES.photoRequired
  }
  return errors
}

/** Campos del backend → campos del formulario. */
export const SERVER_FIELD_MAP: Record<string, keyof IncidentFormErrors> = {
  care_unit: 'careUnit',
  support_area: 'supportArea',
  description: 'description',
  prior_actions: 'priorActions',
  equipment_qr_status: 'noQrReason',
  qr_code: 'qrCode',
  qr_capture_method: 'qrCode',
  photo: 'photo',
}

/** Fechas siempre en hora de Lima, sin depender del navegador. */
export { formatDateTime } from '../../shared/dates'

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
