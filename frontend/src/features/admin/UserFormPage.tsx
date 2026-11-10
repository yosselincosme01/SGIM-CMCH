import { type FormEvent, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router'

import { isApiError } from '../../shared/api/errors'
import { useDocumentTitle } from '../../shared/hooks/useDocumentTitle'
import { Alert } from '../../shared/ui/Alert'
import { Button } from '../../shared/ui/Button'
import { Dialog } from '../../shared/ui/Dialog'
import { LoadingState } from '../../shared/ui/LoadingState'
import { TextField } from '../../shared/ui/TextField'
import { adminUserPath, PATHS } from '../../shared/paths'
import { AdminBreadcrumb } from './AdminDashboardPage'
import {
  type AdminOptions,
  type AdminUser,
  type AreaFunction,
  createUser,
  fetchAdminOptions,
  fetchUser,
  type ManagedRole,
  type Membership,
  resetUserPassword,
  setUserActive,
  updateUser,
} from './api'

interface FormState {
  username: string
  first_name: string
  last_name: string
  email: string
  password: string
  password_confirm: string
  roles: ManagedRole[]
  memberships: Record<string, Membership>
}

const EMPTY: FormState = {
  username: '',
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  password_confirm: '',
  roles: [],
  memberships: {},
}

type Errors = Record<string, string>

function errorsFrom(error: unknown): Errors {
  if (isApiError(error) && error.kind === 'validation') {
    const mapped: Errors = {}
    for (const [key, messages] of Object.entries(error.fieldErrors)) mapped[key] = messages.join(' ')
    return Object.keys(mapped).length ? mapped : { form: error.message }
  }
  if (isApiError(error) && error.status === 409) return { form: error.message }
  if (isApiError(error) && error.kind === 'forbidden') {
    return { form: error.message || 'No tienes permiso para esta acción.' }
  }
  return { form: isApiError(error) ? error.message : 'No se pudo guardar.' }
}

function fromUser(user: AdminUser): FormState {
  return {
    ...EMPTY,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    roles: user.roles.filter((r): r is ManagedRole =>
      ['solicitante', 'planificador', 'personal_atencion'].includes(r),
    ),
    memberships: Object.fromEntries(user.memberships.map((m) => [m.area, m])),
  }
}

/** Alta y edición de una cuenta operativa, con roles y autorizaciones por área. */
export function UserFormPage() {
  const { id } = useParams()
  const userId = id ? Number.parseInt(id, 10) : null
  const navigate = useNavigate()
  const [options, setOptions] = useState<AdminOptions | null>(null)
  const [user, setUser] = useState<AdminUser | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'activation' | 'password' | null>(null)
  const [password, setPassword] = useState({ value: '', confirm: '' })
  useDocumentTitle(userId ? 'Editar usuario' : 'Nuevo usuario')

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchAdminOptions(controller.signal),
      userId ? fetchUser(userId, controller.signal) : Promise.resolve(null),
    ])
      .then(([opts, loaded]) => {
        setOptions(opts)
        if (loaded) {
          setUser(loaded)
          setForm(fromUser(loaded))
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(isApiError(error) && error.status === 404 ? 'El usuario no existe.' : 'No se pudo cargar.')
        }
      })
    return () => controller.abort()
  }, [userId])

  if (loadError) {
    return (
      <div className="stack">
        <AdminBreadcrumb current="Usuario" />
        <Alert tone="danger" live="assertive">
          {loadError}
        </Alert>
      </div>
    )
  }
  if (!options || (userId && !user)) return <LoadingState label="Cargando…" />

  const readOnly = Boolean(user?.is_protected)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: '', form: '' }))
  }

  function toggleRole(role: ManagedRole) {
    const roles = form.roles.includes(role) ? form.roles.filter((r) => r !== role) : [...form.roles, role]
    // Sin el rol, la función por área no tiene efecto: se desmarca.
    const memberships = Object.fromEntries(
      Object.entries(form.memberships).map(([code, m]) => [
        code,
        {
          ...m,
          can_plan: m.can_plan && roles.includes('planificador'),
          can_be_assigned: m.can_be_assigned && roles.includes('personal_atencion'),
          can_verify: m.can_verify && roles.length > 0,
        },
      ]),
    )
    setForm((current) => ({ ...current, roles, memberships }))
    setErrors({})
  }

  function toggleArea(code: string, field: AreaFunction) {
    const current = form.memberships[code] ?? {
      area: code,
      can_plan: false,
      can_be_assigned: false,
      can_verify: false,
    }
    set('memberships', { ...form.memberships, [code]: { ...current, [field]: !current[field] } })
  }

  function validate(): Errors {
    const found: Errors = {}
    if (!userId && !form.username.trim()) found.username = 'Indica el nombre de usuario.'
    if (!form.first_name.trim()) found.first_name = 'Indica el nombre.'
    if (!form.last_name.trim()) found.last_name = 'Indica el apellido.'
    if (!userId) {
      if (!form.password) found.password = 'Define una contraseña inicial.'
      if (form.password !== form.password_confirm) found.password_confirm = 'Las contraseñas no coinciden.'
    }
    return found
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setNotice(null)
    const memberships = Object.values(form.memberships)
      .filter((m) => m.can_plan || m.can_be_assigned || m.can_verify)
      .map(({ area, can_plan, can_be_assigned, can_verify }) => ({
        area,
        can_plan,
        can_be_assigned,
        can_verify: Boolean(can_verify),
      }))
    try {
      if (userId) {
        const updated = await updateUser(userId, {
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          roles: form.roles,
          memberships,
        })
        setUser(updated)
        setForm(fromUser(updated))
        setNotice('Cambios guardados y registrados en la auditoría.')
      } else {
        const created = await createUser({ ...form, memberships })
        navigate(adminUserPath(created.id), { replace: true })
      }
    } catch (error) {
      setErrors(errorsFrom(error))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive() {
    if (!user) return
    setConfirm(null)
    setSaving(true)
    try {
      const updated = await setUserActive(user.id, !user.is_active)
      setUser(updated)
      setNotice(updated.is_active ? 'Cuenta activada.' : 'Cuenta desactivada. Ya no puede iniciar sesión.')
      setErrors({})
    } catch (error) {
      setErrors(errorsFrom(error))
    } finally {
      setSaving(false)
    }
  }

  async function doReset() {
    if (!user) return
    setConfirm(null)
    setSaving(true)
    try {
      await resetUserPassword(user.id, password.value, password.confirm)
      setPassword({ value: '', confirm: '' })
      setNotice('Contraseña restablecida. Las sesiones abiertas de esa cuenta se cerraron.')
      setErrors({})
    } catch (error) {
      setErrors(errorsFrom(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack" inert={confirm !== null} aria-hidden={confirm !== null || undefined}>
      <AdminBreadcrumb current={userId ? (user?.username ?? 'Usuario') : 'Nuevo usuario'} />
      <header className="page__header">
        <p className="page__eyebrow">Administración · Usuarios y permisos</p>
        <h1 className="page__title">{userId ? user?.full_name : 'Nuevo usuario'}</h1>
        {user && (
          <p className="page__lead">
            {user.username} · {user.is_active ? 'Cuenta activa' : 'Cuenta desactivada'}
          </p>
        )}
      </header>

      {readOnly && (
        <Alert tone="info" title="Cuenta protegida">
          Las cuentas administrativas, de superusuario o de staff solo se gestionan mediante el
          procedimiento técnico de TI.
        </Alert>
      )}
      {notice && (
        <Alert tone="success" live="polite">
          {notice}
        </Alert>
      )}
      {errors.form && (
        <Alert tone="danger" live="assertive">
          {errors.form}
        </Alert>
      )}

      <form className="form-card" noValidate onSubmit={save}>
        <fieldset className="form-section" disabled={readOnly}>
          <legend className="form-section__title">Datos de la cuenta</legend>
          <TextField
            label="Nombre de usuario"
            required
            value={form.username}
            readOnly={Boolean(userId)}
            autoComplete="off"
            hint={userId ? 'No se puede cambiar para conservar la trazabilidad.' : 'Una cuenta por persona.'}
            onChange={(event) => set('username', event.target.value)}
            error={errors.username}
          />
          <TextField label="Nombres" required value={form.first_name} onChange={(event) => set('first_name', event.target.value)} error={errors.first_name} />
          <TextField label="Apellidos" required value={form.last_name} onChange={(event) => set('last_name', event.target.value)} error={errors.last_name} />
          <TextField label="Correo institucional" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} error={errors.email} />
        </fieldset>

        {!userId && (
          <fieldset className="form-section">
            <legend className="form-section__title">Contraseña inicial</legend>
            <p className="field__hint">
              Debe cumplir las reglas del sistema (al menos 10 caracteres, no común ni solo
              numérica). Comunícala a la persona por un canal seguro; no se vuelve a mostrar.
            </p>
            <TextField label="Contraseña" type="password" required autoComplete="new-password" value={form.password} onChange={(event) => set('password', event.target.value)} error={errors.password} />
            <TextField label="Repite la contraseña" type="password" required autoComplete="new-password" value={form.password_confirm} onChange={(event) => set('password_confirm', event.target.value)} error={errors.password_confirm} />
          </fieldset>
        )}

        <fieldset className="form-section" disabled={readOnly}>
          <legend className="form-section__title">Roles</legend>
          <p className="field__hint">El rol Administrador no se puede otorgar desde la aplicación.</p>
          <div className="checkbox-list">
            {options.roles.map((role) => (
              <label key={role.code} className="reason-option">
                <input type="checkbox" checked={form.roles.includes(role.code)} onChange={() => toggleRole(role.code)} />
                <span>{role.label}</span>
              </label>
            ))}
          </div>
          {errors.roles && <p className="field__error">{errors.roles}</p>}
        </fieldset>

        <fieldset className="form-section" disabled={readOnly}>
          <legend className="form-section__title">Autorizaciones por área</legend>
          <p className="field__hint">
            Cada autorización es independiente y vale solo para su área. Planificar atenciones
            requiere el rol Responsable de Área; registrar atenciones, Personal de Atención; verificar
            conformidad, cualquier rol. Nadie verifica un cierre de una atención que realizó.
          </p>
          <ul className="area-auth-list">
            {options.areas.map((area) => {
              const current = form.memberships[area.code]
              return (
                <li key={area.code} className="area-auth">
                  <span className="area-auth__name">{area.name}</span>
                  <label className="reason-option">
                    <input
                      type="checkbox"
                      checked={Boolean(current?.can_plan)}
                      disabled={!form.roles.includes('planificador')}
                      onChange={() => toggleArea(area.code, 'can_plan')}
                      aria-label={`Planificar atenciones en ${area.name}`}
                    />
                    <span>Planificar atenciones</span>
                  </label>
                  <label className="reason-option">
                    <input
                      type="checkbox"
                      checked={Boolean(current?.can_be_assigned)}
                      disabled={!form.roles.includes('personal_atencion')}
                      onChange={() => toggleArea(area.code, 'can_be_assigned')}
                      aria-label={`Registrar atenciones en ${area.name}`}
                    />
                    <span>Registrar atenciones</span>
                  </label>
                  <label className="reason-option">
                    <input
                      type="checkbox"
                      checked={Boolean(current?.can_verify)}
                      disabled={form.roles.length === 0}
                      onChange={() => toggleArea(area.code, 'can_verify')}
                      aria-label={`Verificar conformidad en ${area.name}`}
                    />
                    <span>Verificar conformidad</span>
                  </label>
                </li>
              )
            })}
          </ul>
          {errors.memberships && <p className="field__error">{errors.memberships}</p>}
          {user && user.open_assignment_areas.length > 0 && (
            <p className="field__hint">
              Tiene asignaciones vigentes en: {user.open_assignment_areas.join(', ')}. No se puede
              retirar su función técnica allí hasta que se reasignen.
            </p>
          )}
        </fieldset>

        {!readOnly && (
          <div className="form-actions">
            <Link to={PATHS.adminUsers} className="btn btn--ghost">
              Volver
            </Link>
            <Button type="submit" loading={saving} loadingText="Guardando…">
              {userId ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </div>
        )}
      </form>

      {user && !readOnly && (
        <>
          <section className="detail-card" aria-labelledby="account-status">
            <h2 id="account-status" className="detail-card__title">
              Estado de la cuenta
            </h2>
            <p>
              {user.is_active
                ? 'Al desactivarla, la persona no podrá iniciar sesión. Su historial se conserva.'
                : 'La cuenta está desactivada y no puede iniciar sesión.'}
            </p>
            <Button variant={user.is_active ? 'danger' : 'secondary'} onClick={() => setConfirm('activation')}>
              {user.is_active ? 'Desactivar cuenta' : 'Activar cuenta'}
            </Button>
          </section>

          <section className="detail-card" aria-labelledby="account-reset">
            <h2 id="account-reset" className="detail-card__title">
              Restablecer acceso
            </h2>
            <p className="field__hint">
              Define una contraseña nueva. Las sesiones abiertas de la cuenta se cerrarán.
            </p>
            <TextField label="Nueva contraseña" type="password" autoComplete="new-password" value={password.value} onChange={(event) => setPassword({ ...password, value: event.target.value })} error={errors.password} />
            <TextField label="Repite la nueva contraseña" type="password" autoComplete="new-password" value={password.confirm} onChange={(event) => setPassword({ ...password, confirm: event.target.value })} error={errors.password_confirm} />
            <Button variant="secondary" disabled={!password.value || password.value !== password.confirm} onClick={() => setConfirm('password')}>
              Restablecer contraseña
            </Button>
          </section>
        </>
      )}

      {confirm &&
        user &&
        createPortal(
          <Dialog
            title={confirm === 'activation' ? (user.is_active ? '¿Desactivar la cuenta?' : '¿Activar la cuenta?') : '¿Restablecer la contraseña?'}
            actions={
              <>
                <Button variant="secondary" onClick={() => setConfirm(null)}>
                  Cancelar
                </Button>
                <Button
                  variant={confirm === 'activation' && user.is_active ? 'danger' : 'primary'}
                  onClick={() => void (confirm === 'activation' ? toggleActive() : doReset())}
                >
                  Confirmar
                </Button>
              </>
            }
          >
            <p>
              {confirm === 'activation'
                ? `${user.full_name} (${user.username}) ${user.is_active ? 'no podrá iniciar sesión' : 'podrá volver a iniciar sesión'}. La acción queda registrada en la auditoría.`
                : `Se cambiará la contraseña de ${user.username} y se cerrarán sus sesiones. La acción queda registrada en la auditoría.`}
            </p>
          </Dialog>,
          document.body,
        )}
    </div>
  )
}
