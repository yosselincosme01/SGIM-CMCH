import { Route, Routes } from 'react-router'

import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth, RequireRole } from '../features/auth/RequireAuth'
import { ROLE_VIEWS } from '../features/auth/roles'
import { AppLayout } from '../features/workspace/AppLayout'
import { HomePage } from '../features/workspace/HomePage'
import { RolePage } from '../features/workspace/RolePage'
import { ForbiddenPage, NotFoundPage } from '../features/workspace/StatusPages'

/**
 * Rutas de la aplicación.
 *
 * /login                 Inicio de sesión (público)
 * /                      Inicio: selector de vistas autorizadas
 * /solicitante           Vista Solicitante
 * /responsable-area      Vista Responsable de Área (rol planificador)
 * /personal-atencion     Vista Personal de Atención
 * /administrador         Vista Administrador
 * /sin-acceso            Vista no autorizada para el usuario
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          {ROLE_VIEWS.map((view) => (
            <Route
              key={view.role}
              path={view.path}
              element={
                <RequireRole role={view.role}>
                  <RolePage role={view.role} />
                </RequireRole>
              }
            />
          ))}
          <Route path="/sin-acceso" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
