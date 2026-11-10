# ADR 0007: Administración restringida, indicadores y reportes

- **Estado:** propuesto. Implementado en `feature/admin-dashboards-reports`.
- **Actualizado por:** [ADR 0008](0008-funciones-independientes-por-area.md). Verificar conformidad es una función propia (`can_verify`), separada de planificar y sin exigir el rol Planificador, y toda cuenta operativa registra incidencias. La navegación y la consulta global de incidencias del Administrador están en el [ADR 0009](0009-navegacion-por-capacidades.md).
- **Fecha:** 2026-11-07
- **Relacionado:** [ADR 0002](0002-autenticacion-y-roles.md) (roles),
  [ADR 0004](0004-planificacion.md) (funciones por área),
  [ADR 0006](0006-atencion-verificacion.md) (ciclo de atención)

## Contexto

El MVP necesita que la clínica gestione sus cuentas operativas y consulte indicadores
sin depender del superusuario de Django. Al mismo tiempo, la cuenta que administra
usuarios es un objetivo atractivo para un atacante: si pudiera crear otros
administradores o darse más permisos, una sola credencial comprometida daría control
total.

## Decisión

### 1. Administrador operativo, distinto del superusuario

- El rol `administrador` es el Group que ya existía. **No hay un sistema de roles
  paralelo** y `is_superuser` no es una autorización universal: `has_role` solo considera
  los roles asignados de forma explícita (ADR 0004).
- **Mínimo privilegio.** El Administrador puede:
  - crear, editar, activar y desactivar cuentas operativas;
  - asignar y retirar los roles Solicitante, Planificador y Personal de Atención;
  - gestionar las pertenencias a TI, Ingeniería Clínica y Mantenimiento, con
    `can_plan` y `can_be_assigned`;
  - restablecer el acceso definiendo una contraseña nueva.
- **Separación de funciones.** El Administrador **no puede**:
  - otorgar el rol `administrador`, ni enviar `is_superuser`, `is_staff`, `groups`,
    `username` o `password` en una edición (respuesta 400);
  - modificar cuentas administrativas, de superusuario o de staff (403);
  - modificar, desactivar ni restablecer su propia cuenta (403);
  - planificar, atender ni cerrar incidencias. Su visibilidad global de indicadores
    **no** le da acceso al detalle operativo de los tickets.
- **Cuentas administrativas:** solo se crean con el procedimiento técnico de TI
  `python manage.py create_sgim_admin`, documentado en [administracion.md](../administracion.md).
  La cuenta creada no es superusuario ni staff, y su creación queda auditada.

### 2. Reglas de consistencia de las cuentas

- Una función por área exige el rol correspondiente. Al retirar un rol, se retiran sus
  funciones.
- **No se deja trabajo sin seguimiento:** si la persona tiene asignaciones vigentes,
  no se puede desactivar ni retirarle la función técnica en esa área (409). Primero el
  Planificador debe reasignar.
- **Desactivar** conserva el historial. Django rechaza el inicio de sesión y deja de
  aceptar las sesiones abiertas de la cuenta.
- **Contraseñas:** siempre con las reglas de Django (`validate_password`). Nunca se
  muestran, no hay credenciales predeterminadas y no se guardan en la auditoría.
  Restablecer una contraseña invalida las sesiones abiertas de la cuenta.
- Cada cuenta es individual, con varios roles posibles y sin UPS asociada.

### 3. Auditoría (`administration.AuditLog`)

- Es de solo adición: no hay API de modificación y en el admin es de solo lectura.
- **Registra:** creación de cuentas, cambios de datos, cambios de roles y de
  autorizaciones por área (valores anteriores y nuevos), activación, desactivación,
  restablecimiento de acceso, creación de administradores por TI y cada exportación de
  reportes (reporte, alcance, filtros y número de filas).
- Guarda el autor, la fecha, la acción y la cuenta afectada. **Nunca** guarda
  contraseñas, hashes ni contenido exportado.
- El Administrador la consulta en `GET /api/v1/admin/audit/`.

### 4. Indicadores (`GET /api/v1/reports/dashboard/`)

- **Alcance aplicado en el backend, también en las consultas agregadas:**
  - **Administrador:** todas las áreas.
  - **Planificador:** solo las áreas donde tiene el rol y `can_plan=True`. Pedir otra
    área responde 403.
  - **Cualquier otro rol,** incluido un superusuario sin rol: 403.
- **Filtros:** fechas de registro en hora de Lima (por defecto, 30 días; máximo 366),
  área y estado.
- **Sin dobles conteos.** Las métricas se separan en tres grupos:
  - **Por ticket:** total, abiertas, pendientes de gestión (registradas o reabiertas por
    programar), en proceso (última intervención En proceso o No solucionado), cerradas,
    pendientes de verificación y reabiertas alguna vez.
  - **Por ciclo:** conformes, no conformes y reaperturas.
  - **Por intervención:** total y desglose por resultado.
- **Tiempos promedio observados**, sin SLA:
  - desde el registro hasta la primera intervención;
  - desde el registro hasta el cierre técnico vigente.
- **Desgloses:** por estado, área, prioridad y UPS.

### 5. Reportes Excel (`GET /api/v1/reports/<reporte>/export/`)

- `.xlsx` real generado con **openpyxl 3.1.5** (licencia MIT, sin servicios externos).
- **Cinco reportes:**
  1. Incidencias generales.
  2. Tiempos de atención y cierre.
  3. Intervenciones.
  4. Pendientes.
  5. Verificaciones y reaperturas.
- Usan los mismos filtros y el mismo alcance que los indicadores.
- **Seguridad:**
  - **Inyección de fórmulas:** los textos que empiezan por `=`, `+`, `-`, `@`,
    tabulación o retorno se exportan con un apóstrofo inicial y como celda de texto.
  - Se eliminan los caracteres de control no válidos en XML.
  - Solo se exportan datos operativos: nada de correos, contraseñas ni rutas de archivos.
  - **Límites:** 5000 filas por descarga (400 con un mensaje para acotar) y 366 días de
    rango.
  - Las cabeceras de la respuesta incluyen `Cache-Control: private, no-store` y
    `X-Content-Type-Options: nosniff`.
  - Cada descarga se audita.
- Sin PDF ni herramientas externas de BI.

## Consecuencias

- Una credencial de Administrador comprometida no permite tomar el control total: no
  puede crear administradores ni dar privilegios, ni tocar cuentas protegidas.
- Las cuentas administrativas dependen de TI. Es un paso manual intencional, para
  separar la gestión diaria de la gestión de privilegios.
- Los indicadores se calculan al vuelo. Con el volumen esperado del MVP no se justifica
  materializarlos; si el volumen crece, se pueden precalcular sin cambiar la API.

## Pendiente de validar con Walter

1. Si el Administrador debe ver el detalle de las incidencias, solo para consulta. Hoy
   solo ve indicadores y reportes.
2. Si se requiere forzar el cambio de contraseña en el primer inicio de sesión. Hoy no
   está implementado.
3. Cuánto tiempo se conserva la auditoría y quién puede consultarla, además del
   Administrador.
4. Qué indicadores adicionales necesita la dirección, sin definir SLA.
5. Si los reportes deben incluir el nombre del solicitante o anonimizarlo según la
   política de datos de la clínica. Hoy incluyen el nombre.
