/**
 * Rutas visibles de la aplicación (ADR 0009). Se nombran por funcionalidad, no por rol:
 * el usuario no necesita conocer los roles internos.
 */
const CODE = /^[A-Za-z0-9-]{3,20}$/

function withCode(prefix: string, code: string): string {
  if (!CODE.test(code)) throw new Error('Código de incidencia no válido.')
  return `${prefix}/${encodeURIComponent(code)}`
}

export const PATHS = {
  home: '/',
  account: '/mi-cuenta',
  newIncident: '/incidencias/nueva',
  myIncidents: '/incidencias',
  attention: '/atenciones',
  planning: '/planificacion',
  verifications: '/verificaciones',
  indicators: '/indicadores',
  reports: '/reportes',
  admin: '/administracion',
  adminIncidents: '/administracion/incidencias',
  adminUsers: '/administracion/usuarios',
  adminNewUser: '/administracion/usuarios/nuevo',
  adminAudit: '/administracion/auditoria',
  forbidden: '/sin-acceso',
} as const

export const myIncidentPath = (code: string) => withCode(PATHS.myIncidents, code)
/** Detalle propio con la encuesta lista para responder (lo pidió la persona, ADR 0012). */
export const evaluateSurveyPath = (code: string) => `${myIncidentPath(code)}?evaluar=1`
export const attentionIncidentPath = (code: string) => withCode(`${PATHS.attention}/incidencias`, code)
export const planningIncidentPath = (code: string) => withCode(`${PATHS.planning}/incidencias`, code)
export const verificationIncidentPath = (code: string) =>
  withCode(`${PATHS.verifications}/incidencias`, code)
export const adminIncidentPath = (code: string) => withCode(PATHS.adminIncidents, code)
export const adminUserPath = (id: number) => `${PATHS.adminUsers}/${id}`

/**
 * Rutas anteriores (vistas por rol) → rutas actuales. Conservan los enlaces guardados.
 * El orden importa: los prefijos más largos van primero.
 */
export const LEGACY_PREFIXES: readonly (readonly [string, string])[] = [
  ['/solicitante/incidencias/nueva', PATHS.newIncident],
  ['/solicitante/incidencias', PATHS.myIncidents],
  ['/solicitante', PATHS.myIncidents],
  ['/planificador/indicadores', PATHS.indicators],
  ['/planificador', PATHS.planning],
  ['/responsable-area', PATHS.planning],
  ['/personal-atencion', PATHS.attention],
  ['/administrador', PATHS.admin],
]

/** Traduce una ruta anterior a la actual, o ``null`` si no es una ruta anterior. */
export function legacyTarget(pathname: string): string | null {
  for (const [from, to] of LEGACY_PREFIXES) {
    if (pathname === from || pathname.startsWith(`${from}/`)) {
      return `${to}${pathname.slice(from.length)}`
    }
  }
  return null
}
