/** Mensajes comprensibles para el usuario. Nunca muestran detalles técnicos del servidor. */
import type { ApiError } from '../../shared/api/errors'
import type { AuthNotice } from './authContext'

export interface NoticeMessage {
  tone: 'info' | 'success' | 'warning'
  title: string
  text: string
}

export function noticeMessage(notice: AuthNotice): NoticeMessage {
  switch (notice.kind) {
    case 'session-expired':
      return {
        tone: 'warning',
        title:
          notice.reason === 'absolute'
            ? 'Tu sesión alcanzó la duración máxima permitida'
            : notice.reason === 'idle'
              ? 'Tu sesión se cerró por inactividad'
              : 'Tu sesión expiró',
        text: 'Por seguridad, ocultamos la información de la pantalla. Inicia sesión nuevamente para continuar.',
      }
    case 'session-ended':
      return {
        tone: 'warning',
        title: 'Tu sesión terminó',
        text: 'Por seguridad, ocultamos la información de la pantalla. Inicia sesión nuevamente.',
      }
    case 'signed-out':
      return { tone: 'success', title: 'Cerraste sesión correctamente', text: '' }
    case 'signed-out-elsewhere':
      return {
        tone: 'info',
        title: 'Se cerró la sesión',
        text: 'La sesión se cerró en otra pestaña de este navegador.',
      }
    case 'signed-out-unconfirmed':
      return {
        tone: 'warning',
        title: 'Cerramos la sesión en este equipo',
        text: 'No pudimos confirmarlo con el servidor. Si es un equipo compartido, cierra también el navegador.',
      }
  }
}

export function loginErrorMessage(error: ApiError): string {
  switch (error.kind) {
    case 'validation':
      return error.fieldErrors.non_field_errors?.[0] ?? 'Revisa los datos ingresados.'
    case 'throttled':
      return 'Hiciste demasiados intentos de inicio de sesión. Espera un momento antes de volver a intentarlo.'
    case 'forbidden':
      return error.isCsrfFailure
        ? 'No se pudo verificar la seguridad de la solicitud. Recarga la página e inténtalo de nuevo.'
        : 'No tienes permiso para iniciar sesión.'
    case 'network':
      return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'
    case 'timeout':
      return 'El servidor tardó demasiado en responder. Inténtalo de nuevo en unos minutos.'
    case 'server':
      return 'El servidor no está disponible en este momento. Inténtalo de nuevo en unos minutos.'
    default:
      return 'No se pudo iniciar sesión. Inténtalo de nuevo.'
  }
}
