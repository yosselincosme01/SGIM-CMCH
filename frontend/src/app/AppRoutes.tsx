import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'

import { AdminDashboardPage } from '../features/admin/AdminDashboardPage'
import { UserFormPage } from '../features/admin/UserFormPage'
import { UsersPage } from '../features/admin/UsersPage'
import { AttentionDetailPage } from '../features/attention/AttentionDetailPage'
import { AttentionInboxPage } from '../features/attention/AttentionInboxPage'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAuth, RequireRole } from '../features/auth/RequireAuth'
import { IncidentDetailPage } from '../features/incidents/IncidentDetailPage'
import { IncidentFormPage } from '../features/incidents/IncidentFormPage'
import { MyIncidentsPage } from '../features/incidents/MyIncidentsPage'
import { SolicitantePage } from '../features/incidents/SolicitantePage'
import { PlannerInboxPage } from '../features/planning/PlannerInboxPage'
import { PlannerMetricsPage } from '../features/planning/PlannerMetricsPage'
import { PlanningDetailPage } from '../features/planning/PlanningDetailPage'
import { AppLayout } from '../features/workspace/AppLayout'
import { HomePage } from '../features/workspace/HomePage'
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
 * /personal-atencion                Bandeja del Personal de Atención
 * /personal-atencion/incidencias/:code  Detalle e intervención técnica
 * /planificador/indicadores        Indicadores y reportes de sus áreas
 * /administrador                    Dashboard global y reportes
 * /administrador/usuarios[/nuevo|/:id]  Gestión de cuentas operativas
 * /sin-acceso                       Vista no autorizada para el usuario
 *
 * La restricción por rol es solo de navegación: el backend aplica los permisos.
 */
const LEGACY_PLANNER_PATH = '/responsable-area'

type RouteRole = 'solicitante' | 'planificador' | 'personal_atencion' | 'administrador'

function withRole(role: RouteRole, page: ReactNode) {
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
          <Route
            path="/personal-atencion"
            element={withRole('personal_atencion', <AttentionInboxPage />)}
          />
          <Route
            path="/personal-atencion/incidencias/:code"
            element={withRole('personal_atencion', <AttentionDetailPage />)}
          />
          <Route
            path="/planificador/indicadores"
            element={withRole('planificador', <PlannerMetricsPage />)}
          />
          <Route path="/administrador" element={withRole('administrador', <AdminDashboardPage />)} />
          <Route path="/administrador/usuarios" element={withRole('administrador', <UsersPage />)} />
          <Route
            path="/administrador/usuarios/nuevo"
            element={withRole('administrador', <UserFormPage />)}
          />
          <Route
            path="/administrador/usuarios/:id"
            element={withRole('administrador', <UserFormPage key="edit" />)}
          />
          <Route path="/sin-acceso" element={<ForbiddenPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
