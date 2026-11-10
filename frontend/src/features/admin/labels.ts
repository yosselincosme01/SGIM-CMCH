/** Nombres visibles de los roles (el identificador técnico no cambia). */
export const ROLE_LABELS: Record<string, string> = {
  solicitante: 'Solicitante',
  planificador: 'Responsable de Área',
  personal_atencion: 'Personal de Atención',
  administrador: 'Administrador',
}

/** Permisos por área, con los mismos nombres del formulario (ADR 0008). */
export const AREA_FUNCTION_LABELS = {
  can_plan: 'Planificar atenciones',
  can_be_assigned: 'Registrar atenciones',
  can_verify: 'Verificar conformidad',
} as const
