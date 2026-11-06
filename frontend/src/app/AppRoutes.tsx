import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router'

import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth, RequireRole } from '../features/auth/RequireAuth'
import { ROLE_VIEWS } from '../features/auth/roles'
import { IncidentDetailPage } from '../features/incidents/IncidentDetailPage'
import { IncidentFormPage } from '../features/incidents/IncidentFormPage'
import { MyIncidentsPage } from '../features/incidents/MyIncidentsPage'
import { SolicitantePage } from '../features/incidents/SolicitantePage'
import { AppLayout } from '../features/workspace/AppLayout'
import { HomePage } from '../features/workspace/HomePage'
import { RolePage } from '../features/workspace/RolePage'
import { ForbiddenPage, NotFoundPage } from '../features/workspace/StatusPages'

/**
 * Rutas de la aplicación.
 *
 * /login                            Inicio de sesión (público)
 * /                                 Inicio: selector de vistas autorizadas
 * /solicitante                      Vista Solicitante
 * /solicitante/incidencias/nueva    Registrar incidencia
 * /solicitante/incidencias          Mis incidencias
 * /solicitante/incidencias/:code    Detalle de una incidencia propia
 * /responsable-area                 Vista Responsable de Área (rol planificador)
 * /personal-atencion                Vista Personal de Atención
 * /administrador                    Vista Administrador
 * /sin-acceso                       Vista no autorizada para el usuario
 *
 * La restricción por rol es solo de navegación: el backend aplica los permisos.
 */
function solicitante(page: ReactNode) {
  return <RequireRole role="solicitante">{page}</RequireRole>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="/solicitante" element={solicitante(<SolicitantePage />)} />
          <Route path="/solicitante/incidencias/nueva" element={solicitante(<IncidentFormPage />)} />
          <Route path="/solicitante/incidencias" element={solicitante(<MyIncidentsPage />)} />
          <Route
            path="/solicitante/incidencias/:code"
            element={solicitante(<IncidentDetailPage />)}
          />
          {ROLE_VIEWS.filter((view) => view.role !== 'solicitante').map((view) => (
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
