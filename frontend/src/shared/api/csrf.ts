/**
 * Token CSRF de Django. Vive en la cookie ``csrftoken`` (legible a propósito) y se
 * reenvía en la cabecera ``X-CSRFToken``. Nunca se copia a localStorage/sessionStorage.
 */
export const CSRF_COOKIE_NAME = 'csrftoken'
export const CSRF_HEADER_NAME = 'X-CSRFToken'

export function readCsrfToken(cookies: string = document.cookie): string | null {
  for (const part of cookies.split(';')) {
    const [rawName, ...rest] = part.trim().split('=')
    if (rawName === CSRF_COOKIE_NAME) {
      const value = decodeURIComponent(rest.join('='))
      return value || null
    }
  }
  return null
}
