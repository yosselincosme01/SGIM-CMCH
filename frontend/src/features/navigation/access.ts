/**
 * Acceso a las funcionalidades según los **permisos efectivos** del backend (ADR 0009).
 *
 * Es la única fuente de verdad para el menú y para la protección de rutas, de modo que
 * la interfaz nunca ofrece algo que la ruta luego rechace, ni al revés. Solo adapta la
 * navegación: el backend vuelve a validar cada consulta y cada acción con el área
 * concreta. No hay selector de roles.
 */
import type { CurrentUser } from '../auth/api'
import { PATHS } from '../../shared/paths'

/** Funcionalidades protegidas. Cada una corresponde a un grupo de rutas. */
export type Feature =
  | 'incidents' // registrar incidencias y consultar las propias
  | 'attention' // mis atenciones (técnico con can_attend en alguna área)
  | 'planning' // planificación (can_plan en alguna área)
  | 'verifications' // verificaciones (can_verify en alguna área)
  | 'analysis' // indicadores y reportes de sus áreas (Responsable de Área con can_plan)
  | 'reports' // reportes Excel (Responsable de Área con can_plan, o Administrador)
  | 'admin' // administración del sistema

type AccessUser = Pick<CurrentUser, 'roles' | 'capabilities'>

const OPERATIONAL_ROLES = ['solicitante', 'planificador', 'personal_atencion']

/** Cuenta operativa: con algún rol de trabajo. El rol Administrador no es operativo. */
export function isOperational(user: AccessUser): boolean {
  return user.roles.some((role) => OPERATIONAL_ROLES.includes(role))
}

/**
 * Administración del SGIM. Es la única funcionalidad que depende del rol, porque no
 * tiene función por área; y no concede ninguna función operativa (ADR 0007).
 */
export function isAdministrator(user: AccessUser): boolean {
  return user.roles.includes('administrador')
}

/**
 * Cuenta exclusivamente administrativa: rol Administrador sin ningún rol operativo. Su
 * pantalla principal es el Dashboard general; no tiene "Inicio" operativo.
 */
export function isAdminOnly(user: AccessUser): boolean {
  return isAdministrator(user) && !isOperational(user)
}

/** Pantalla principal de la cuenta: a donde llevan el logotipo y el inicio de sesión. */
export function homePath(user: AccessUser): string {
  return isAdminOnly(user) ? PATHS.admin : PATHS.home
}

export function canAccess(user: AccessUser, feature: Feature): boolean {
  const capabilities = user.capabilities
  switch (feature) {
    case 'incidents':
      return isOperational(user)
    case 'attention':
      return capabilities?.can_attend === true
    case 'planning':
      return capabilities?.can_plan === true
    case 'verifications':
      return capabilities?.can_verify === true
    case 'analysis':
      return capabilities?.can_plan === true && !isAdministrator(user)
    case 'reports':
      return capabilities?.can_plan === true || isAdministrator(user)
    case 'admin':
      return isAdministrator(user)
  }
}

export interface MenuItem {
  label: string
  path: string
  /** Solo se marca activa con la ruta exacta (no con sus rutas hijas). */
  end?: boolean
}

export interface MenuGroup {
  id: 'general' | 'operations' | 'analysis' | 'administration'
  label: string
  items: MenuItem[]
}

/**
 * Menú único con todas las funcionalidades permitidas, sin duplicados. Los grupos sin
 * opciones no se muestran. Las encuestas de satisfacción no aparecen hasta que existan
 * (Etapa 3): no se muestran enlaces vacíos.
 *
 * "Inicio" (dashboard operativo) no se ofrece a las cuentas exclusivamente
 * administrativas: para ellas sería la misma pantalla que "Dashboard general". Una
 * cuenta administrativa y operativa ve ambas, cada una con su contenido.
 */
export function buildMenu(user: AccessUser): MenuGroup[] {
  const groups: MenuGroup[] = [
    {
      id: 'general',
      label: 'General',
      items: [
        ...(isAdminOnly(user) ? [] : [{ label: 'Inicio', path: PATHS.home, end: true }]),
        ...(canAccess(user, 'incidents')
          ? [
              { label: 'Registrar incidencia', path: PATHS.newIncident, end: true },
              { label: 'Mis incidencias', path: PATHS.myIncidents },
            ]
          : []),
      ],
    },
    {
      id: 'operations',
      label: 'Operaciones',
      items: [
        ...(canAccess(user, 'attention') ? [{ label: 'Mis atenciones', path: PATHS.attention }] : []),
        ...(canAccess(user, 'planning') ? [{ label: 'Planificación', path: PATHS.planning }] : []),
        ...(canAccess(user, 'verifications')
          ? [{ label: 'Verificaciones', path: PATHS.verifications }]
          : []),
      ],
    },
    {
      id: 'analysis',
      label: 'Análisis',
      items: [
        ...(canAccess(user, 'analysis') ? [{ label: 'Indicadores', path: PATHS.indicators }] : []),
        ...(canAccess(user, 'reports') ? [{ label: 'Reportes', path: PATHS.reports }] : []),
      ],
    },
    {
      id: 'administration',
      label: 'Administración',
      items: canAccess(user, 'admin')
        ? [
            { label: 'Dashboard general', path: PATHS.admin, end: true },
            { label: 'Consulta de incidencias', path: PATHS.adminIncidents },
            { label: 'Usuarios y permisos', path: PATHS.adminUsers },
            { label: 'Auditoría', path: PATHS.adminAudit },
          ]
        : [],
    },
  ]
  const visible = groups.filter((group) => group.items.length > 0)
  // En una cuenta exclusivamente administrativa, su pantalla principal va primero.
  if (isAdminOnly(user)) {
    return [
      ...visible.filter((group) => group.id === 'administration'),
      ...visible.filter((group) => group.id !== 'administration'),
    ]
  }
  return visible
}

/**
 * Opción activa para la ruta actual: la de ruta más larga que coincide, para que
 * "Registrar incidencia" no marque también "Mis incidencias", y el detalle de un ticket
 * marque la sección de la que forma parte.
 */
export function activeItemPath(menu: MenuGroup[], pathname: string): string | null {
  let best: string | null = null
  for (const item of menu.flatMap((group) => group.items)) {
    const matches = item.end
      ? pathname === item.path
      : pathname === item.path || pathname.startsWith(`${item.path}/`)
    if (matches && (best === null || item.path.length > best.length)) best = item.path
  }
  return best
}

/** Tiene alguna funcionalidad además de Inicio. */
export function hasAnyFeature(user: AccessUser): boolean {
  return buildMenu(user).some((group) => group.items.some((item) => item.path !== PATHS.home))
}
