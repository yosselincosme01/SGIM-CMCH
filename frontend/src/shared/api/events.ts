/**
 * Eventos del cliente de API. Permiten que la capa de autenticación reaccione a un
 * 401 o a la actividad del usuario sin acoplar el cliente a React.
 */
import type { ApiError } from './errors'

type Listener<T> = (payload: T) => void

function createChannel<T>() {
  const listeners = new Set<Listener<T>>()
  return {
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(payload: T): void {
      for (const listener of [...listeners]) listener(payload)
    },
  }
}

/** Una petición recibió 401 (sesión inexistente o vencida). */
export const unauthorizedEvents = createChannel<ApiError>()

/** Una petición activa (no pasiva) terminó con éxito: el servidor renovó la inactividad. */
export const activityEvents = createChannel<void>()
