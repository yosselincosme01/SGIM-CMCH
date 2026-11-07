import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'

import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth, RequireRole } from '../features/auth/RequireAuth'
import { ROLE_VIEWS } from '../features/auth/roles'
import { IncidentDetailPage } from '../features/incidents/IncidentDetailPage'
import { IncidentFormPage } from '../features/incidents/IncidentFormPage'
import { MyIncidentsPage } from '../features/incidents/MyIncidentsPage'
import { SolicitantePage } from '../features/incidents/SolicitantePage'
import { PlannerInboxPage } from '../features/planning/PlannerInboxPage'
import { PlanningDetailPage } from '../features/planning/PlanningDetailPage'
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
 * /planificador                     Vista Planificador: bandeja de sus áreas autorizadas
 * /planificador/incidencias/:code   Detalle, priorización y programación
 * /responsable-area/*               Ruta anterior: redirige a /planificador/*
 * /personal-atencion                Vista Personal de Atención
 * /administrador                    Vista Administrador
 * /sin-acceso                       Vista no autorizada para el usuario
 *
 * La restricción por rol es solo de navegación: el backend aplica los permisos.
 */
const LEGACY_PLANNER_PATH = '/responsable-area'

function withRole(role: 'solicitante' | 'planificador', page: ReactNode) {
  return <RequireRole role={role}>{page}</RequireRole>
}

/** Compatibilidad con enlaces guardados de la ruta anterior del Planificador. */
function LegacyPlannerRedirect() {
  const { pathname, search, hash } = useLocation()
  const rest = pathname.slice(LEGACY_PLANNER_PATH.length)
  return <Navigate to={`/planificador${rest}${search}${hash}`} replace />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="/solicitante" element={withRole('solicitante', <SolicitantePage />)} />
          <Route
            path="/solicitante/incidencias/nueva"
            element={withRole('solicitante', <IncidentFormPage />)}
          />
          <Route
            path="/solicitante/incidencias"
            element={withRole('solicitante', <MyIncidentsPage />)}
          />
          <Route
            path="/solicitante/incidencias/:code"
            element={withRole('solicitante', <IncidentDetailPage />)}
          />
          <Route path="/planificador" element={withRole('planificador', <PlannerInboxPage />)} />
          <Route
            path="/planificador/incidencias/:code"
            element={withRole('planificador', <PlanningDetailPage />)}
          />
          <Route path={`${LEGACY_PLANNER_PATH}/*`} element={<LegacyPlannerRedirect />} />
          {ROLE_VIEWS.filter(
            (view) => view.role !== 'solicitante' && view.role !== 'planificador',
          ).map((view) => (
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
