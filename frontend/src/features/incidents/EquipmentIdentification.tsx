import { type ReactNode, useRef, useState } from 'react'

import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import {
  type EquipmentMode,
  NO_QR_REASONS,
  type NoQrReason,
  type QrCaptureMethod,
  validateQrCode,
} from './equipment'
import { QrCodeInput } from './QrCodeInput'
import { cameraSupport } from './camera'
import { QrScanner } from './QrScanner'

export interface EquipmentErrors {
  equipmentMode?: string
  noQrReason?: string
  qrCode?: string
}

interface EquipmentIdentificationProps {
  mode: EquipmentMode | ''
  reason: NoQrReason | ''
  qrCode: string
  captureMethod: QrCaptureMethod
  errors: EquipmentErrors
  onModeChange: (mode: EquipmentMode) => void
  onReasonChange: (reason: NoQrReason) => void
  onQrCode: (value: string, method: QrCaptureMethod) => void
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
      />
      <circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function KeyboardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
      <rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"
      />
    </svg>
  )
}

function IdOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="11" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M14 10h3M14 14h3M4 20 20 4" />
    </svg>
  )
}

/**
 * Sección "Identificación del equipo" (mobile-first): dos opciones principales.
 * El escaneo solo se ofrece si el navegador permite usar la cámara (HTTPS o
 * localhost); siempre se puede escribir el contenido del QR.
 */
export function EquipmentIdentification({
  mode,
  reason,
  qrCode,
  captureMethod,
  errors,
  onModeChange,
  onReasonChange,
  onQrCode,
}: EquipmentIdentificationProps) {
  const [support] = useState(cameraSupport)
  const [scanning, setScanning] = useState(false)
  const [cameraMessage, setCameraMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const canScan = support === 'available'

  function handleDetected(text: string) {
    setScanning(false)
    const problem = validateQrCode(text)
    if (problem) {
      setCameraMessage(`El QR leído no se puede usar: ${problem} Escribe su contenido.`)
      inputRef.current?.focus()
      return
    }
    setCameraMessage(null)
    onQrCode(text.trim(), 'scan')
    inputRef.current?.focus()
  }

  function handleCameraError(message: string) {
    setScanning(false)
    setCameraMessage(message)
    inputRef.current?.focus()
  }

  const options: { value: EquipmentMode; title: string; subtitle: string; icon: ReactNode }[] = [
    canScan
      ? { value: 'qr', title: 'Escanear QR', subtitle: 'Usar cámara', icon: <CameraIcon /> }
      : { value: 'qr', title: 'Código QR', subtitle: 'Escribir el contenido', icon: <KeyboardIcon /> },
    {
      value: 'none',
      title: 'No tiene QR / No aplica',
      subtitle: 'Adjuntarás una fotografía',
      icon: <IdOffIcon />,
    },
  ]

  return (
    <fieldset
      className="form-section equipment"
      data-field="equipmentMode"
      aria-describedby={errors.equipmentMode ? 'equipment-mode-error' : undefined}
    >
      <legend className="form-section__title">
        Identificación del equipo <span className="field__required" aria-hidden="true">*</span>
      </legend>
      <p className="field__hint">Agiliza el registro si el activo está identificado.</p>
      <p className="field__label" id="equipment-question">
        ¿El equipo tiene código QR?
      </p>
      <div
        className="equipment__options"
        role="radiogroup"
        aria-labelledby="equipment-question"
        aria-required="true"
        aria-invalid={errors.equipmentMode ? true : undefined}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={`equipment-option${mode === option.value ? ' equipment-option--selected' : ''}`}
          >
            <input
              type="radio"
              name="equipment_mode"
              value={option.value}
              checked={mode === option.value}
              onChange={() => {
                setCameraMessage(null)
                onModeChange(option.value)
              }}
              className="equipment-option__input"
            />
            <span className="equipment-option__icon">{option.icon}</span>
            <span className="equipment-option__text">
              <span className="equipment-option__title">{option.title}</span>
              <span className="equipment-option__subtitle">{option.subtitle}</span>
            </span>
          </label>
        ))}
      </div>
      {errors.equipmentMode && (
        <p id="equipment-mode-error" className="field__error">
          {errors.equipmentMode}
        </p>
      )}

      {mode === 'qr' && (
        <div className="equipment__panel" data-field="qrCode">
          {canScan && (
            <Button onClick={() => setScanning(true)} fullWidth>
              Abrir cámara
            </Button>
          )}
          {cameraMessage && (
            <Alert tone="warning" live="polite">
              {cameraMessage}
            </Alert>
          )}
          <QrCodeInput
            ref={inputRef}
            value={qrCode}
            onChange={(value) => onQrCode(value, 'manual')}
            error={errors.qrCode}
            hint={
              captureMethod === 'scan' && qrCode
                ? 'Leído con la cámara. Puedes corregirlo si es necesario.'
                : canScan
                  ? 'Si el QR está deteriorado o no se puede leer, escribe su contenido aquí.'
                  : 'Escríbelo tal como aparece en la etiqueta del equipo.'
            }
          />
          {support === 'insecure' && (
            <p className="field__hint">
              La cámara solo está disponible en una conexión segura (HTTPS).
            </p>
          )}
        </div>
      )}

      {mode === 'none' && (
        <fieldset
          className="equipment__panel equipment__reasons"
          data-field="noQrReason"
          aria-describedby={errors.noQrReason ? 'no-qr-reason-error' : undefined}
        >
          <legend className="field__label">
            Motivo <span className="field__required" aria-hidden="true">*</span>
          </legend>
          {NO_QR_REASONS.map((item) => (
            <label
              key={item.value}
              className={`reason-option${reason === item.value ? ' reason-option--selected' : ''}`}
            >
              <input
                type="radio"
                name="no_qr_reason"
                value={item.value}
                checked={reason === item.value}
                aria-invalid={errors.noQrReason ? true : undefined}
                onChange={() => onReasonChange(item.value)}
              />
              <span>{item.label}</span>
            </label>
          ))}
          {errors.noQrReason && (
            <p id="no-qr-reason-error" className="field__error">
              {errors.noQrReason}
            </p>
          )}
          <p className="field__hint">
            Adjunta una fotografía en la sección Evidencia: es obligatoria en este caso.
          </p>
        </fieldset>
      )}

      {scanning && (
        <QrScanner
          onDetected={handleDetected}
          onCancel={() => setScanning(false)}
          onError={handleCameraError}
        />
      )}
    </fieldset>
  )
}
