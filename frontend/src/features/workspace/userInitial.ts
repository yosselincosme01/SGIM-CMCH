import type { CurrentUser } from '../auth/api'

/** Inicial del usuario a partir de sus datos reales: nombre, nombre completo o usuario. */
export function userInitial(user: Pick<CurrentUser, 'first_name' | 'full_name' | 'username'>): string {
  const source = [user.first_name, user.full_name, user.username]
    .map((value) => value?.trim() ?? '')
    .find((value) => value.length > 0)
  return source ? [...source][0].toLocaleUpperCase('es-PE') : '?'
}
