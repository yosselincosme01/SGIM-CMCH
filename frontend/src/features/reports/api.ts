/**
 * Indicadores y reportes (backend/apps/administration, ADR 0007). El backend decide el
 * alcance: el Administrador ve todas las áreas; el Planificador, solo las autorizadas.
 */
import { apiRequest, downloadRequest } from '../../shared/api/client'

export interface ReportOptions {
  scope: 'global' | 'planner'
  areas: { code: string; name: string }[]
  reports: { code: string; label: string }[]
  max_rows: number
  max_range_days: number
}

export interface MetricFilters {
  date_from?: string
  date_to?: string
  area?: string
  status?: string
}

export interface Breakdown {
  key: string
  label: string
  total: number
}

export interface Dashboard {
  scope: 'global' | 'planner'
  filters: Required<MetricFilters>
  tickets: {
    total: number
    open: number
    pending_management: number
    in_progress: number
    closed: number
    pending_verification: number
    reopened: number
  }
  cycles: { conforming: number; not_conforming: number; reopenings: number }
  interventions: { total: number; by_result: Breakdown[] }
  times: {
    avg_hours_to_first_intervention: number | null
    tickets_with_intervention: number
    avg_hours_to_closure: number | null
    closed_tickets_measured: number
  }
  by_status: Breakdown[]
  by_area: Breakdown[]
  by_care_unit: Breakdown[]
  by_priority: Breakdown[]
}

export function query(filters: MetricFilters): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function fetchReportOptions(signal?: AbortSignal) {
  return apiRequest<ReportOptions>('/reports/options/', { signal })
}

export function fetchDashboard(filters: MetricFilters, signal?: AbortSignal) {
  return apiRequest<Dashboard>(`/reports/dashboard/${query(filters)}`, { signal })
}

const REPORT_CODE = /^[a-z]{3,20}$/

/** Descarga el .xlsx y lo guarda con el nombre que propone el servidor. */
export async function downloadReport(code: string, filters: MetricFilters) {
  if (!REPORT_CODE.test(code)) throw new Error('Reporte no válido.')
  const file = await downloadRequest(
    `/reports/${code}/export/${query(filters)}`,
    `sgim-${code}.xlsx`,
  )
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return file.filename
}
