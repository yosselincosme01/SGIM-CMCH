/**
 * Lectura de QR con la cámara del navegador (ADR 0005).
 *
 * - Solo funciona en contextos seguros (HTTPS o localhost): es una restricción del
 *   navegador y no se intenta evitar.
 * - El permiso de cámara lo concede el usuario. Si lo deniega, o no hay cámara, se
 *   ofrece el ingreso manual.
 * - Lector: `BarcodeDetector` nativo cuando el navegador lo soporta (Chrome para
 *   Android); si no, `jsQR`, que se carga solo cuando hace falta (Safari en iPhone,
 *   Firefox).
 * - El contenido leído se devuelve como texto. Nunca se abre ni se ejecuta.
 * - No se graban ni se envían imágenes de la cámara.
 */

export type CameraSupport = 'available' | 'insecure' | 'unsupported'

/** ¿Se puede ofrecer el escaneo en este navegador? */
export function cameraSupport(): CameraSupport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported'
  // En HTTP (salvo localhost) el navegador no expone la cámara.
  if (window.isSecureContext === false) return 'insecure'
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') return 'unsupported'
  return 'available'
}

export type CameraErrorKind = 'denied' | 'not-found' | 'busy' | 'insecure' | 'other'

export function cameraError(error: unknown): { kind: CameraErrorKind; message: string } {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        kind: 'denied',
        message:
          'No se dio permiso para usar la cámara. Escribe el contenido del QR o habilita la cámara en la configuración del navegador.',
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return {
        kind: 'not-found',
        message: 'No se encontró una cámara disponible. Escribe el contenido del QR.',
      }
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        kind: 'busy',
        message:
          'La cámara está en uso por otra aplicación. Ciérrala e inténtalo de nuevo, o escribe el contenido del QR.',
      }
    case 'SecurityError':
      return {
        kind: 'insecure',
        message: 'El navegador bloqueó la cámara en esta conexión. Escribe el contenido del QR.',
      }
    default:
      return {
        kind: 'other',
        message: 'No se pudo usar la cámara. Escribe el contenido del QR.',
      }
  }
}

export interface QrDecoder {
  /** Intenta leer un QR del fotograma actual. Devuelve el texto o `null`. */
  decode(video: HTMLVideoElement): Promise<string | null>
}

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}

interface NativeBarcodeDetectorClass {
  new (options: { formats: string[] }): NativeBarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

async function nativeDecoder(): Promise<QrDecoder | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeBarcodeDetectorClass }).BarcodeDetector
  if (!Detector) return null
  try {
    const formats = (await Detector.getSupportedFormats?.()) ?? ['qr_code']
    if (!formats.includes('qr_code')) return null
    const detector = new Detector({ formats: ['qr_code'] })
    return {
      async decode(video) {
        const [first] = await detector.detect(video)
        return first?.rawValue ?? null
      },
    }
  } catch {
    return null
  }
}

/** Lado máximo del fotograma que se analiza con jsQR (rendimiento en celulares). */
const MAX_FRAME_SIDE = 720

async function jsQrDecoder(): Promise<QrDecoder> {
  const { default: jsQR } = await import('jsqr')
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return {
    async decode(video) {
      const { videoWidth, videoHeight } = video
      if (!context || !videoWidth || !videoHeight) return null
      const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(videoWidth, videoHeight))
      const width = Math.round(videoWidth * scale)
      const height = Math.round(videoHeight * scale)
      canvas.width = width
      canvas.height = height
      context.drawImage(video, 0, 0, width, height)
      const result = jsQR(context.getImageData(0, 0, width, height).data, width, height, {
        inversionAttempts: 'attemptBoth',
      })
      return result?.data || null
    },
  }
}

export async function createQrDecoder(): Promise<QrDecoder> {
  return (await nativeDecoder()) ?? jsQrDecoder()
}

export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } },
  })
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}
