import { useEffect } from 'react'

export const APP_NAME = 'SGIM-CMCH'

/** Título de la pestaña. No incluye datos personales: puede verse en equipos compartidos. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME
  }, [title])
}
