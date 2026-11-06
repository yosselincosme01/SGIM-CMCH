import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'

import { AppRoutes } from '../app/AppRoutes'
import { AuthProvider } from '../features/auth/AuthProvider'
import {
  DEFAULT_SESSION_SETTINGS,
  type SessionSettings,
  SessionSettingsContext,
} from '../features/session/sessionSettings'
import { TEST_PASSWORD } from './fakeBackend'

/** Tiempos cortos para que las pruebas de sesión no esperen minutos. */
export const FAST_SESSION_SETTINGS: SessionSettings = {
  ...DEFAULT_SESSION_SETTINGS,
  pollIntervalMs: 60_000,
  tickMs: 50,
  recheckMs: 50,
  activityDebounceMs: 20,
}

export function renderApp(route = '/', settings: Partial<SessionSettings> = {}) {
  const user = userEvent.setup()
  const result = render(
    <SessionSettingsContext.Provider value={{ ...FAST_SESSION_SETTINGS, ...settings }}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </MemoryRouter>
    </SessionSettingsContext.Provider>,
  )
  return { user, ...result }
}

export async function fillLogin(
  user: ReturnType<typeof userEvent.setup>,
  username: string,
  password = TEST_PASSWORD,
) {
  if (username) await user.type(await screen.findByLabelText(/usuario/i), username)
  if (password) await user.type(screen.getByLabelText(/^contraseña/i), password)
  await user.click(screen.getByRole('button', { name: /ingresar/i }))
}
