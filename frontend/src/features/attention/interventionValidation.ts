/** Reglas del formulario de intervención (orientan al usuario; el backend las repite). */
import type { InterventionResult } from '../incidents/api'
import type { InterventionInput } from './api'

export const TEXT_MAX = 2000
export const REASON_MIN = 10
export const PHOTOS_MAX = 5

export const RESULTS: { value: InterventionResult; label: string; hint: string }[] = [
  { value: 'solved', label: 'Solucionado', hint: 'La incidencia se cerrará y quedará pendiente de verificación.' },
  { value: 'in_progress', label: 'En proceso', hint: 'Seguirá abierta; podrás registrar otra intervención.' },
  { value: 'not_solved', label: 'No solucionado', hint: 'Seguirá abierta; el Responsable de Área verá el pendiente.' },
]

export type Field =
  | 'diagnosis'
  | 'actionsTaken'
  | 'result'
  | 'usedParts'
  | 'usedPartsDetail'
  | 'partsRequired'
  | 'partsRequiredDetail'
  | 'unresolvedReason'
  | 'observations'
  | 'photos'
export type Errors = Partial<Record<Field | 'form', string>>

export const SERVER_FIELDS: Record<string, Field> = {
  diagnosis: 'diagnosis',
  actions_taken: 'actionsTaken',
  result: 'result',
  used_parts: 'usedParts',
  used_parts_detail: 'usedPartsDetail',
  parts_required: 'partsRequired',
  parts_required_detail: 'partsRequiredDetail',
  unresolved_reason: 'unresolvedReason',
  observations: 'observations',
  photos: 'photos',
}

export const FIELD_ORDER: Field[] = [
  'diagnosis',
  'actionsTaken',
  'result',
  'unresolvedReason',
  'usedParts',
  'usedPartsDetail',
  'partsRequired',
  'partsRequiredDetail',
  'photos',
]

export type Values = Omit<InterventionInput, 'assignment'>

export const EMPTY: Values = {
  diagnosis: '',
  actionsTaken: '',
  result: '',
  usedParts: null,
  usedPartsDetail: '',
  partsRequired: null,
  partsRequiredDetail: '',
  unresolvedReason: '',
  observations: '',
  photos: [],
}

export function validateIntervention(values: Values): Errors {
  const errors: Errors = {}
  const required = (value: string, field: Field, label: string) => {
    if (!value.trim()) errors[field] = `${label} es obligatorio.`
    else if (value.trim().length > TEXT_MAX) errors[field] = `No puede superar ${TEXT_MAX} caracteres.`
  }
  required(values.diagnosis, 'diagnosis', 'El diagnóstico técnico')
  required(values.actionsTaken, 'actionsTaken', 'Las acciones realizadas')
  if (!values.result) errors.result = 'Selecciona el resultado de la intervención.'
  if (values.usedParts === null) errors.usedParts = 'Indica si se utilizaron repuestos.'
  else if (values.usedParts && !values.usedPartsDetail.trim())
    errors.usedPartsDetail = 'Describe los repuestos utilizados.'
  if (values.partsRequired === null) errors.partsRequired = 'Indica si se requieren repuestos.'
  else if (values.partsRequired && !values.partsRequiredDetail.trim())
    errors.partsRequiredDetail = 'Describe los repuestos requeridos.'
  if (values.result && values.result !== 'solved' && values.unresolvedReason.trim().length < REASON_MIN)
    errors.unresolvedReason = `Indica el motivo (al menos ${REASON_MIN} caracteres) si no quedó solucionado.`
  if (values.photos.length === 0) errors.photos = 'Adjunta al menos una fotografía de evidencia.'
  return errors
}
