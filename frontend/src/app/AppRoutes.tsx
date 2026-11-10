import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'

import { AdminDashboardPage } from '../features/admin/AdminDashboardPage'
import { AuditPage } from '../features/admin/AuditPage'
import { GlobalIncidentDetailPage, GlobalIncidentsPage } from '../features/admin/GlobalIncidentsPages'
import { UserFormPage } from '../features/admin/UserFormPage'
import { UsersPage } from '../features/admin/UsersPage'
import { AttentionDetailPage } from '../features/attention/AttentionDetailPage'
import { AttentionInboxPage } from '../features/attention/AttentionInboxPage'
import { LoginPage } from '../features/auth/LoginPage'
import { RequireAccess, RequireAuth } from '../features/auth/RequireAuth'
import { IncidentDetailPage } from '../features/incidents/IncidentDetailPage'
import { IncidentFormPage } from '../features/incidents/IncidentFormPage'
import { MyIncidentsPage } from '../features/incidents/MyIncidentsPage'
import type { Feature } from '../features/navigation/access'
import { PlannerInboxPage } from '../features/planning/PlannerInboxPage'
import { PlanningDetailPage } from '../features/planning/PlanningDetailPage'
import { VerificationsPage } from '../features/planning/VerificationsPage'
import { IndicatorsPage, ReportsPage } from '../features/reports/AnalysisPages'
import { AccountPage } from '../features/workspace/AccountPage'
import { AppLayout } from '../features/workspace/AppLayout'
import { HomePage } from '../features/workspace/HomePage'
import { ForbiddenPage, NotFoundPage } from '../features/workspace/StatusPages'
import { legacyTarget } from '../shared/paths'

/**
 * Rutas de la aplicación (ADR 0009). Se nombran por funcionalidad, no por rol, y cada
 * una exige la misma funcionalidad que el menú (``features/navigation/access.ts``). Es
 * solo navegación: el backend aplica los permisos en cada endpoint.
 *
 * /login                                   Inicio de sesión (público)
 * /                                        Inicio (accesos directos; Administración si
 *                                          la cuenta es solo administrativa)
 * /mi-cuenta                               Datos y funciones de la cuenta
 * /incidencias/nueva                       Registrar incidencia        (cuenta operativa)
 * /incidencias[/:code]                     Mis incidencias             (cuenta operativa)
 * /atenciones[/incidencias/:code]          Mis atenciones              (can_attend)
 * /planificacion[/incidencias/:code]       Planificación               (can_plan)
 * /verificaciones[/incidencias/:code]      Verificaciones              (can_verify)
 * /indicadores                             Indicadores de sus áreas    (can_plan)
 * /reportes                                Reportes Excel              (can_plan o Administrador)
 * /administracion                          Dashboard general           (Administrador)
 * /administracion/incidencias[/:code]      Consulta global, lectura    (Administrador)
 * /administracion/usuarios[/nuevo|/:id]    Usuarios y permisos         (Administrador)
 * /administracion/auditoria                Auditoría                   (Administrador)
 * /sin-acceso                              Funcionalidad no autorizada
 *
 * Las rutas anteriores por rol (/solicitante, /planificador, /responsable-area,
 * /personal-atencion, /administrador) redirigen a las actuales.
 */
function guard(feature: Feature, page: ReactNode) {
  return <RequireAccess feature={feature}>{page}</RequireAccess>
}

/** Rutas anteriores: redirige a la ruta actual conservando la consulta. */
function LegacyOrNotFound() {
  const { pathname, search, hash } = useLocation()
  const target = legacyTarget(pathname)
  if (target) return <Navigate to={`${target}${search}${hash}`} replace />
  return <NotFoundPage />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="/mi-cuenta" element={<AccountPage />} />

          <Route path="/incidencias/nueva" element={guard('incidents', <IncidentFormPage />)} />
          <Route path="/incidencias" element={guard('incidents', <MyIncidentsPage />)} />
          <Route path="/incidencias/:code" element={guard('incidents', <IncidentDetailPage />)} />

          <Route path="/atenciones" element={guard('attention', <AttentionInboxPage />)} />
          <Route
            path="/atenciones/incidencias/:code"
            element={guard('attention', <AttentionDetailPage />)}
          />
          <Route path="/planificacion" element={guard('planning', <PlannerInboxPage />)} />
          <Route
            path="/planificacion/incidencias/:code"
            element={guard('planning', <PlanningDetailPage mode="plan" />)}
          />
          <Route path="/verificaciones" element={guard('verifications', <VerificationsPage />)} />
          <Route
            path="/verificaciones/incidencias/:code"
            element={guard('verifications', <PlanningDetailPage mode="verify" />)}
          />

          <Route path="/indicadores" element={guard('analysis', <IndicatorsPage />)} />
          <Route path="/reportes" element={guard('reports', <ReportsPage />)} />

          <Route path="/administracion" element={guard('admin', <AdminDashboardPage />)} />
          <Route
            path="/administracion/incidencias"
            element={guard('admin', <GlobalIncidentsPage />)}
          />
          <Route
            path="/administracion/incidencias/:code"
            element={guard('admin', <GlobalIncidentDetailPage />)}
          />
          <Route path="/administracion/usuarios" element={guard('admin', <UsersPage />)} />
          <Route path="/administracion/usuarios/nuevo" element={guard('admin', <UserFormPage />)} />
          <Route path="/administracion/usuarios/:id" element={guard('admin', <UserFormPage />)} />
          <Route path="/administracion/auditoria" element={guard('admin', <AuditPage />)} />

          <Route path="/sin-acceso" element={<ForbiddenPage />} />
          <Route path="*" element={<LegacyOrNotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
