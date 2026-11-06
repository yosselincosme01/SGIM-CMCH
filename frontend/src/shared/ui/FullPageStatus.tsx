import type { ReactNode } from 'react'

import { Spinner } from './Spinner'

interface FullPageStatusProps {
  title: string
  children?: ReactNode
  loading?: boolean
}

/** Pantalla completa para estados globales (verificando sesión, error de conexión). */
export function FullPageStatus({ title, children, loading = false }: FullPageStatusProps) {
  return (
    <main className="fullpage" id="contenido">
      <div className="fullpage__card">
        {loading && <Spinner label={title} />}
        <h1 className="fullpage__title">{title}</h1>
        {children}
      </div>
    </main>
  )
}
