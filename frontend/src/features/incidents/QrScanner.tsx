import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { cameraError, createQrDecoder, openCamera, stopCamera } from './camera'

const SCAN_INTERVAL_MS = 200

interface QrScannerProps {
  /** Contenido leído, como texto. Quien lo recibe lo valida; nunca se abre. */
  onDetected: (text: string) => void
  onCancel: () => void
  /** La cámara no se pudo usar (permiso denegado, sin cámara…). */
  onError: (message: string) => void
}

/**
 * Vista de escaneo: pide la cámara trasera, analiza los fotogramas y se cierra al
 * leer un QR. Siempre libera la cámara al cerrarse. No guarda imágenes.
 */
export function QrScanner({ onDetected, onCancel, onError }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  // Siempre llaman a la versión más reciente de las funciones del formulario.
  const emitDetected = useEffectEvent(onDetected)
  const emitError = useEffectEvent(onError)

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let active = true

    async function start() {
      try {
        stream = await openCamera()
        if (!active) return stopCamera(stream)
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        const decoder = await createQrDecoder()
        if (!active) return
        setReady(true)
        const tick = async () => {
          if (!active) return
          try {
            const text = await decoder.decode(video)
            if (text && active) {
              active = false
              stopCamera(stream)
              emitDetected(text)
              return
            }
          } catch {
            // Un fotograma que no se pudo analizar no detiene el escaneo.
          }
          timer = setTimeout(tick, SCAN_INTERVAL_MS)
        }
        void tick()
      } catch (error) {
        if (!active) return
        active = false
        stopCamera(stream)
        emitError(cameraError(error).message)
      }
    }

    void start()
    return () => {
      active = false
      clearTimeout(timer)
      stopCamera(stream)
    }
  }, [])

  return createPortal(
    <Dialog
      title="Escanear código QR"
      role="dialog"
      actions={
        <Button variant="secondary" onClick={onCancel} fullWidth>
          Cancelar
        </Button>
      }
    >
      <div className="qr-scanner">
        <video
          ref={videoRef}
          className="qr-scanner__video"
          muted
          playsInline
          aria-label="Vista de la cámara"
        />
        <div className="qr-scanner__frame" aria-hidden="true" />
      </div>
      <p className="qr-scanner__status" role="status">
        {ready ? 'Apunta la cámara al código QR del equipo.' : 'Abriendo la cámara…'}
      </p>
    </Dialog>,
    document.body,
  )
}
