/**
 * Vistas de la interfaz por rol del backend.
 *
 * Solo define nombres, rutas y descripciones funcionales. NO define permisos sobre
 * incidencias: el backend es la autoridad y esos permisos se implementarán con
 * su módulo. Un usuario puede tener varios roles y cambiar de vista sin volver a
 * iniciar sesión. Ningún rol vincula al usuario con una UPS.
 */
import type { BackendRole, CurrentUser } from './api'

export interface RoleView {
  role: BackendRole
  label: string
  path: string
  summary: string
}

/** Orden fijo de presentación. */
export const ROLE_VIEWS: readonly RoleView[] = [
  {
    role: 'solicitante',
    label: 'Solicitante',
    path: '/solicitante',
    summary: 'Registro y seguimiento de las incidencias que reportas.',
  },
  {
    role: 'planificador',
    label: 'Responsable de Área',
    path: '/responsable-area',
    summary: 'Gestión de prioridades, programación, asignaciones y supervisión.',
  },
  {
    role: 'personal_atencion',
    label: 'Personal de Atención',
    path: '/personal-atencion',
    summary: 'Registro de actividades y resultados de las atenciones asignadas.',
  },
  {
    role: 'administrador',
    label: 'Administrador',
    path: '/administrador',
    summary: 'Gestión de usuarios, roles y catálogos del sistema.',
  },
]

export function getRoleView(role: BackendRole): RoleView {
  const view = ROLE_VIEWS.find((item) => item.role === role)
  if (!view) throw new Error(`Rol desconocido: ${role}`)
  return view
}

/** Vistas autorizadas para el usuario. Ignora roles que la interfaz no conoce. */
export function getAuthorizedViews(user: Pick<CurrentUser, 'roles'>): RoleView[] {
  const roles = new Set(user.roles)
  return ROLE_VIEWS.filter((view) => roles.has(view.role))
}

export function hasRole(user: Pick<CurrentUser, 'roles'>, role: BackendRole): boolean {
  return user.roles.includes(role)
}

export function findViewByPath(pathname: string): RoleView | undefined {
  return ROLE_VIEWS.find((view) => pathname === view.path || pathname.startsWith(`${view.path}/`))
}
