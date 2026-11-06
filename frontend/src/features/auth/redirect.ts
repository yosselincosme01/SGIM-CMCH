/** Solo se aceptan rutas internas de la aplicación (evita redirecciones abiertas). */
export function safeRedirectTarget(from: unknown): string {
  if (typeof from !== 'string') return '/'
  if (!from.startsWith('/') || from.startsWith('//') || from.startsWith('/\\')) return '/'
  if (from === '/login' || from.startsWith('/login?') || from.startsWith('/login/')) return '/'
  return from
}
