# ADR 0004: Planificación y asignación de incidencias

- **Estado:** propuesto. Implementado en `feature/incident-planning`. Las reglas de
  prioridad, plazos, reasignación y estados están **pendientes de validar con Walter**.
- **Fecha:** 2026-11-06
- **Relacionado:** [ADR 0002](0002-autenticacion-y-roles.md), [ADR 0003](0003-incidencias.md)

## Alcance

El **Planificador** consulta las incidencias de sus áreas autorizadas, evalúa su
prioridad y programa su atención: asigna un técnico responsable y una fecha y hora
estimada.

**No incluye** la intervención técnica, la conformidad del solicitante, el cierre, la
derivación entre áreas, los tiempos máximos de atención (SLA) ni las notificaciones.

## Denominación

- El rol se llama **Planificador** en la interfaz, la documentación y los mensajes. Ya no se usa "Responsable de Área".
- El identificador técnico se mantiene: `planificador`.
- La ruta del frontend es `/planificador`. La ruta anterior `/responsable-area/*` redirige a `/planificador/*`.

## Decisiones confirmadas

### 1. Permisos por área: rol global **y** función en el área

`SupportAreaMembership` tiene dos funciones, **desactivadas por defecto**:

| Campo | Para qué | Requiere además |
|---|---|---|
| `can_plan` | Planificar las incidencias del área | Rol `planificador` |
| `can_be_assigned` | Recibir asignaciones del área | Rol `personal_atencion` |

- Una persona puede planificar en un área y ser técnico en otra.
- El rol sin la función no da acceso, y la función sin el rol tampoco.
- La simple pertenencia al área, sin ninguna función, tampoco da acceso.
- **Las funciones no se habilitaron automáticamente** a partir de los roles existentes.
  Cada una se asigna de forma explícita en el admin. Ver [pertenencias](../planificacion-pertenencias.md).
- **Ni el administrador ni el superusuario tienen acceso global.** `has_role` ya no da
  todos los roles al superusuario (actualiza el ADR 0002).
- La UPS de la incidencia no interviene en los permisos.

Todas las reglas de acceso viven en `apps/incidents/selectors.py`. **Todas** las rutas
las usan, también las de la etapa anterior:

| Ruta | Regla |
|---|---|
| `GET /incidents/?scope=mine` | Solo las incidencias que registró el usuario |
| `GET /incidents/?scope=area` | Áreas donde el usuario tiene una función (Planificador o técnico); 403 si no tiene ninguna |
| `GET /incidents/<código>/` y su evidencia | Las propias o las de sus áreas con función; 404 en los demás casos |
| `GET /incidents/options/` y `POST /incidents/` | Rol `solicitante` explícito |

### 2. Endpoints de planificación

| Método y ruta | Uso | Permiso |
|---|---|---|
| `GET /incidents/planning/` | Bandeja paginada. Filtros: `area`, `status`, `priority` (`none` = sin prioridad), `technician`, `scheduled_on` (fecha en hora de Lima) y `q`. Orden: `ordering` | Rol `planificador`. Solo incluye áreas con `can_plan` |
| `GET /incidents/planning/options/` | Áreas que el usuario planifica, prioridades activas y contadores | El mismo permiso |
| `GET /incidents/<código>/technicians/` | Técnicos autorizados del área y su carga vigente | Planificador del área |
| `PUT /incidents/<código>/priority/` | Fija o cambia la prioridad, también antes de programar | Planificador del área |
| `POST /incidents/<código>/planning/` | Programa, reprograma o reasigna | Planificador del área |

Respuestas de error:
- **400:** datos no válidos o campos no permitidos (por ejemplo, `status` o `assigned_by`).
- **403:** el usuario puede ver la incidencia, pero no planificarla.
- **404:** el usuario no puede ver la incidencia.
- **409:** cambio concurrente, o estado que ya no permite planificar.

Todas las escrituras exigen CSRF.

### 3. Asignaciones (`IncidentAssignment`)

- Cada asignación tiene un técnico responsable, una fecha y hora estimada, indicaciones
  internas y quién la programó.
- **Solo una asignación vigente** por incidencia. Lo garantiza una restricción `UNIQUE` parcial en la base de datos.
- Las asignaciones **no se editan**. Reasignar o reprogramar cierra la vigente
  (`ended_at`) y crea una nueva con su motivo. El historial queda completo.
- Una persona responsable por asignación (provisional). Esto no impide que otros técnicos
  intervengan en etapas futuras.
- **Técnico válido:** usuario activo, con el rol `personal_atencion` y con
  `can_be_assigned` en el área de la incidencia.
  - Un Planificador solo puede asignarse a sí mismo si también cumple esa condición en la misma área.
  - Si el técnico no es válido, la API responde siempre con el mismo mensaje, para no revelar si una cuenta existe.

### 4. Programación y fechas

- La programación inicial no puede quedar en el pasado. Se acepta el minuto en curso.
- **No hay un límite máximo** de días hacia adelante.
- Al reprogramar, la fecha nueva tampoco puede estar en el pasado.
- **Toda reprogramación o reasignación exige un motivo** de entre 10 y 500 caracteres.
  Si no cambian ni el técnico ni la fecha, la API responde 400.
- **Zona horaria:** las fechas se guardan en UTC. Se presentan e interpretan en
  `America/Lima` (`SGIM_DISPLAY_TIME_ZONE`), sin depender de `TIME_ZONE` ni del sistema
  operativo.
  - El frontend envía `AAAA-MM-DDTHH:mm` sin zona horaria, y el backend lo interpreta como hora de Lima.
  - Para mostrar fechas se usa `Intl` con `timeZone: 'America/Lima'`.

### 5. Concurrencia

- Cada operación bloquea la incidencia con `select_for_update` dentro de una transacción.
- El bloqueo se limita a las filas propias: `select_for_update(of=("self",))`, que genera
  `FOR UPDATE OF "incidents_incident"`, y lo mismo para la asignación vigente.
  - `priority` es opcional y se carga con un LEFT OUTER JOIN. PostgreSQL no permite
    bloquear el lado nulable de esa unión.
  - Las áreas, los niveles de prioridad y los usuarios técnicos son filas compartidas:
    bloquearlas frenaría otras operaciones sin necesidad.
- Al programar o reprogramar, el cliente envía `expected_assignment`: la asignación vigente que estaba viendo, o `null`.
  Si ya no coincide, la API responde **409** y no modifica nada.
- Si una operación falla, se revierte completa: prioridad, asignación, estado y eventos.

### 6. Estados y trazabilidad

- La transición `registrada` → `asignada` ocurre en la primera programación. El ciclo completo (cierre, verificación y reapertura) se define en el [ADR 0006](0006-atencion-verificacion.md).
- Cada cambio queda en `IncidentEvent`, con su autor y su fecha:

| Evento | Qué registra |
|---|---|
| `priority_changed` | Prioridad anterior y nueva, y el motivo si se indicó |
| `assigned` | Técnico, fecha estimada y prioridad; estado `registrada` → `asignada` |
| `technician_changed` | Técnico anterior y nuevo, y el motivo |
| `schedule_changed` | Fecha anterior y nueva (hora de Lima), y el motivo |

- Si una operación cambia varias cosas a la vez, se registra un evento por cada cambio.

### 7. Qué ve cada perfil

| Dato | Planificador o técnico del área | Solicitante (provisional) |
|---|---|---|
| Estado | Sí | Sí |
| Fecha estimada de atención | Sí | Sí |
| Prioridad | Sí | **No** |
| Técnico responsable | Sí | **No** |
| Indicaciones internas y motivos | Sí | **No** |
| Historial | Completo, con los valores anteriores y nuevos | Registro, programación y reprogramación, sin detalles. Las acciones del área aparecen con el nombre del área |

El backend usa un serializer distinto para cada perfil. La interfaz no oculta datos que
el servidor ya haya enviado: el servidor no los envía.

## Propuestas provisionales (no son políticas oficiales)

- **Prioridades:** se usan provisionalmente Crítica, Alta, Media y Baja, en el catálogo
  `PriorityLevel` con `is_provisional=True`.
  - No tienen descripción, criterios ni plazos.
  - La interfaz las presenta como provisionales.
  - Se pueden ajustar o desactivar desde el admin sin cambiar código.
- **Tiempos máximos de atención (SLA):** no se implementan. Por ejemplo, se podría
  proponer un plazo de respuesta por nivel, pero solo después de que Walter lo valide.
- **Reglas automáticas de prioridad:** ninguna. La prioridad la decide el Planificador.
- **Reasignación:** se permite mientras la incidencia esté `asignada`, sin límite de veces
  y con motivo obligatorio. No hay aprobación adicional.
- **Cambio de prioridad:** el motivo es opcional.

## Pendiente de validar con Walter

1. Los niveles de prioridad, sus nombres, criterios y orden.
2. Los tiempos máximos de atención por nivel y qué ocurre cuando se superan.
3. Las reglas de reasignación y reprogramación: quién puede hacerlas, cuántas veces y si requieren aprobación.
4. Si el cambio de prioridad debe exigir un motivo.
5. Si el solicitante debe ver el nombre del técnico y la prioridad. Hoy no los ve.
6. Si el técnico debe ver todas las incidencias de su área o solo las que tiene asignadas. Hoy ve todas.
7. Los estados definitivos (atención, resolución, conformidad, cierre, anulación, reapertura), su nombre ("Asignada" o "Programada") y sus transiciones.
8. Si debe haber equipos de trabajo además de un responsable principal.
9. El horario laboral: si se puede programar fuera de él.
10. Si el administrador necesita una vista global de la planificación.
11. Las notificaciones al técnico y al solicitante.
12. La derivación de una incidencia a otra área.

## Migraciones

| Migración | Contenido |
|---|---|
| `incidents.0003_planning_schema` | `can_plan` y `can_be_assigned` (en `False`), `PriorityLevel`, `Incident.priority` (nula), estado `asignada`, `IncidentAssignment` con su restricción e índices, nuevos tipos de evento y el índice `(support_area, status)` |
| `incidents.0004_provisional_priority_levels` | Los cuatro niveles provisionales. Es reversible; no borra niveles en uso |

- Ninguna migración modifica pertenencias, usuarios ni permisos.
- Después de aplicarlas, **nadie** tiene funciones por área hasta que se asignen explícitamente.
  Hasta entonces, los usuarios ficticios que antes veían la bandeja de un área dejan de verla.
