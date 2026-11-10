# ADR 0011: Panel de Administración

- **Estado:** propuesto. Implementado en `feature/admin-dashboards-reports`.
- **Fecha:** 2026-11-10
- **Relacionado:** [ADR 0007](0007-administracion-reportes.md) (indicadores y reportes),
  [ADR 0009](0009-navegacion-por-capacidades.md) (navegación y consulta global)

## Contexto

El Dashboard general reutilizaba el panel de indicadores del Responsable de Área. Ese
panel mostraba muchas tarjetas, varios desgloses y los reportes en la misma página. Para
supervisar, el Administrador necesita una vista más breve: volumen, estados, áreas y las
últimas incidencias, con acceso al detalle de solo lectura.

## Decisión

### 1. Panel de Administración (`/administracion`)

- Encabezado **«Panel de Administración»**. En el menú lateral sigue llamándose
  "Dashboard general".
- **Filtros: periodo y área.**
  - El periodo es la fecha de registro, en hora de Lima. Por defecto son los últimos 30
    días, con un máximo de 366, como en los indicadores.
  - Los dos filtros se aplican a todo el panel.
- **Indicadores compactos**, en una sola franja y con datos de `GET /reports/dashboard/`:

  | Indicador | Dato | Qué cuenta |
  |---|---|---|
  | Registradas | `tickets.total` | Incidencias registradas en el periodo |
  | Abiertas | `tickets.open` | No cerradas |
  | En proceso | `tickets.in_progress` | Última intervención En proceso o No solucionado |
  | Cerradas técnicamente | `tickets.closed` | Con cierre técnico vigente |
  | Pendientes de verificación | `tickets.pending_verification` | Las cerradas sin verificar |

- **Distribuciones**, en barras horizontales de una sola serie. Cada barra lleva su
  valor y su porcentaje en texto, y la lista también funciona como tabla.
  - **Por estado:** los cuatro estados reales (`by_status`), incluidos los que están en
    cero.
  - **Por área de soporte:** las áreas activas (`by_area`, completadas con
    `reports/options`), incluidas las que están en cero.
- **Incidencias recientes:** las 5 últimas de `GET /admin/incidents/` con los mismos
  filtros. Cada una enlaza al detalle de solo lectura. Si hay más, se ofrece un enlace a
  la Consulta de incidencias con esos mismos filtros.
- **Lo que sale del panel:**
  - Los promedios de tiempo y los desgloses por prioridad, UPS y resultado de
    intervención. Siguen en los reportes Excel y en Indicadores del Responsable de Área.
  - La descarga de reportes, que tiene su propia sección (**Análisis → Reportes**).
- No hay SLA ni cifras calculadas en el navegador, salvo los porcentajes sobre el total
  del periodo.

### 2. Consulta de incidencias

- Se añade el filtro de **periodo** (`date_from`/`date_to`) a `GET /admin/incidents/`.
  Es opcional, con días completos en hora de Lima, y una fecha inválida o un rango
  invertido responden 400.
- En la interfaz, el periodo usa los parámetros `desde` y `hasta`.
- Se añade el botón **Limpiar filtros**.
- Se mantienen el detalle de solo lectura, la ausencia de evidencias y la ausencia de
  acciones (ADR 0009).

### 3. Usuarios y permisos

- **Listado:**
  - persona (nombre y usuario);
  - roles internos como etiquetas, con «Responsable de Área» como nombre visible;
  - permisos por área, con los nombres del formulario;
  - estado de la cuenta, con su color, y el último acceso;
  - número de cuentas encontradas.
- Las pertenencias sin ningún permiso no se muestran.
- **Sin cambios:**
  - el formulario, con los tres permisos independientes;
  - las reglas del ADR 0007: no se crean Administradores y no hay cambios sobre la propia
    cuenta.

### 4. Reportes y auditoría

Siguen como secciones separadas, sin cambios funcionales.

## Seguridad

- Toda la autorización sigue en el backend. Los endpoints del panel exigen el rol
  Administrador, y el nuevo filtro de periodo solo reduce el resultado.
- El Administrador no obtiene permisos operativos: no hay botones de planificación,
  atención, verificación ni reapertura, ni acceso a evidencias.
