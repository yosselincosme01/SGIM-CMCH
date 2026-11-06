import { Spinner } from './Spinner'

/** Indicador de carga dentro del contenido de una página. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="loading-state">
      <Spinner label={label} />
      <p aria-hidden="true">{label}</p>
    </div>
  )
}
