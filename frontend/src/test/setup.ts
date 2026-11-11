import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'

import { adminBackend } from './fakeAdmin'
import { attentionBackend } from './fakeAttention'
import { backend } from './fakeBackend'
import { homeBackend } from './fakeHome'
import { incidentsBackend } from './fakeIncidents'
import { planningBackend } from './fakePlanning'
import { surveyBackend } from './fakeSurvey'
import { server } from './server'

function clearCookies() {
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
  }
}

// Con la suite en paralelo, 1 s (valor por defecto) produce fallos intermitentes por
// tiempo en equipos cargados. La primera prueba de cada archivo también carga sus
// módulos mientras corren los demás, así que 5 s evita esos falsos fallos y sigue
// detectando esperas que nunca se cumplen (el límite de cada prueba es de 15 s).
configure({ asyncUtilTimeout: 5000 })

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
  surveyBackend.reset()
  clearCookies()
  localStorage.clear()
  sessionStorage.clear()
})

afterAll(() => server.close())
