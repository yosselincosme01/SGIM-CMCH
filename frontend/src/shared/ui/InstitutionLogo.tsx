import logoOnGuinda from '../../assets/brand/Logo-CMCH-fondo-guinda.png'
import logoOnWhite from '../../assets/brand/Logo-CMCH-fondo-blanco.jpg'

/**
 * Logotipo institucional de la Clínica Médica Cayetano Heredia.
 *
 * Usa los archivos originales sin modificarlos (sin recortes, deformaciones ni
 * cambios de color): solo se escalan con `object-fit: contain`.
 * - `on-white`: pantallas con fondo blanco (login). Archivo con fondo blanco.
 * - `on-guinda`: barra superior guinda de las vistas internas. Archivo con fondo guinda.
 *
 * SGIM-CMCH no tiene isotipo propio: su identidad es textual.
 */
const VARIANTS = {
  'on-white': { src: logoOnWhite, width: 1024, height: 321 },
  'on-guinda': { src: logoOnGuinda, width: 1024, height: 275 },
} as const

const INSTITUTION_NAME = 'Clínica Médica Cayetano Heredia'

interface InstitutionLogoProps {
  variant: keyof typeof VARIANTS
  className?: string
}

export function InstitutionLogo({ variant, className }: InstitutionLogoProps) {
  const { src, width, height } = VARIANTS[variant]
  return (
    <img
      src={src}
      width={width}
      height={height}
      alt={INSTITUTION_NAME}
      className={['institution-logo', `institution-logo--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      data-variant={variant}
      decoding="async"
      draggable={false}
    />
  )
}
