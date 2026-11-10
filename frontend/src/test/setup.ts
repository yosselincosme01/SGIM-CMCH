import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { adminBackend } from './fakeAdmin'
import { attentionBackend } from './fakeAttention'
import { backend } from './fakeBackend'
import { homeBackend } from './fakeHome'
import { incidentsBackend } from './fakeIncidents'
import { planningBackend } from './fakePlanning'
import { server } from './server'

function clearCookies() {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

// Con la suite en paralelo, 1 s (valor por defecto) produce fallos intermitentes por
// tiempo en equipos cargados; 3 s sigue detectando esperas que nunca se cumplen.
configure({ asyncUtilTimeout: 3000 })

// Cualquier petición no simulada es un error: las pruebas nunca salen a la red.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))

afterEach(() => {
  cleanup()
  server.resetHandlers()
  backend.reset()
  incidentsBackend.reset()
  planningBackend.reset()
  attentionBackend.reset()
  adminBackend.reset()
  homeBackend.reset()
  clearCookies()
  localStorage.clear()
  sessionStorage.clear()
})

afterAll(() => server.close())
