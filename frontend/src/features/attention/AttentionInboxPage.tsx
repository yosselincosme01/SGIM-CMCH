import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { formatDateTime } from '../../shared/dates'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { attentionIncidentPath } from '../../shared/paths'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { LoadingState } from '../../shared/ui/LoadingState'
import type { Page } from '../incidents/api'
import { StatusBadge } from '../incidents/StatusBadge'
import type { PlanningItem } from '../planning/api'
import { PriorityBadge } from '../planning/PlanningParts'
import { fetchAttentionInbox } from './api'


const STATUS_OPTIONS = [
  { value: 'asignada', label: 'Asignadas a mí' },
  { value: 'cerrada', label: 'Cerradas por mí' },
  { value: '', label: 'Todas' },
]

/** Mis atenciones: asignaciones vigentes de la persona y las que cerró. */
export function AttentionInboxPage() {
  useDocumentTitle('Mis atenciones')
  const [params, setParams] = useSearchParams()
  const status = params.get('estado') ?? 'asignada'
  const day = params.get('fecha') ?? ''
  const [data, setData] = useState<Page<PlanningItem> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchAttentionInbox({ status: status || undefined, scheduled_on: day || undefined }, controller.signal)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setError(isApiError(err) ? err.message : 'No se pudo cargar la bandeja.')
      })
    return () => controller.abort()
  }, [status, day, attempt])

  function update(key: 'estado' | 'fecha', value: string) {
    const next = new URLSearchParams(params)
    if (key === 'estado') next.set('estado', value)
    else if (value) next.set(key, value)
    else next.delete(key)
    setData(null)
    setParams(next)
  }

  return (
    <div className="stack">
      <nav aria-label="Ruta de navegación" className="breadcrumb">
        <ol>
          <li>
            <Link to="/">Inicio</Link>
          </li>
          <li aria-current="page">Mis atenciones</li>
        </ol>
      </nav>
      <header className="page__header">
        <p className="page__eyebrow">Operaciones</p>
        <h1 className="page__title">Mis atenciones</h1>
        <p className="page__lead">Incidencias asignadas a ti y su registro de atención.</p>
      </header>

      <div className="filters filters--inline">
        <div className="filters__grid">
          <div className="field">
            <label className="field__label" htmlFor="attention-status">
              Estado
            </label>
            <select
              id="attention-status"
              className="field__input field__select"
              value={status}
              onChange={(event) => update('estado', event.target.value)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="attention-date">
              Fecha programada
            </label>
            <input
              id="attention-date"
              type="date"
              className="field__input"
              value={day}
              onChange={(event) => update('fecha', event.target.value)}
            />
          </div>
        </div>
      </div>

      {error ? (
        <>
          <Alert tone="danger" title="No se pudo cargar la bandeja" live="assertive">
            {error}
          </Alert>
          <Button onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
        </>
      ) : !data ? (
        <LoadingState label="Cargando incidencias…" />
      ) : data.count === 0 ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No hay incidencias en esta vista</h2>
          <p>Cuando el Responsable de Área te asigne una incidencia, aparecerá aquí.</p>
        </div>
      ) : (
        <table className="data-table planning-table">
          <caption className="visually-hidden">Mis atenciones</caption>
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Prioridad</th>
              <th scope="col">Problema</th>
              <th scope="col">UPS / área</th>
              <th scope="col">Estado</th>
              <th scope="col">Programada</th>
              <th scope="col">
                <span className="visually-hidden">Acción</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((item) => (
              <tr key={item.code}>
                <th scope="row" data-label="Código">
                  <span className="data-table__code">{item.code}</span>
                </th>
                <td data-label="Prioridad">
                  <PriorityBadge priority={item.priority} />
                </td>
                <td data-label="Problema" className="planning-table__excerpt">
                  {item.description_excerpt}
                </td>
                <td data-label="UPS / área">
                  {item.care_unit.name}
                  <span className="planning-table__meta">{item.support_area.name}</span>
                </td>
                <td data-label="Estado">
                  <StatusBadge status={item.status} label={item.status_label} />
                  {item.last_result && (
                    <span className="planning-table__meta">Última: {item.last_result.label}</span>
                  )}
                </td>
                <td data-label="Programada">
                  {item.assignment ? formatDateTime(item.assignment.scheduled_at) : '—'}
                </td>
                <td data-label="Acción">
                  <Link
                    to={attentionIncidentPath(item.code)}
                    className="btn btn--secondary planning-table__action"
                    aria-label={`${item.status === 'asignada' ? 'Atender' : 'Ver'} ${item.code}`}
                  >
                    {item.status === 'asignada' ? 'Atender' : 'Ver'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
