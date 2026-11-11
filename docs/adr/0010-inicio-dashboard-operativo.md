# ADR 0010: Inicio como dashboard operativo personal

- **Estado:** propuesto. Implementado en `feature/admin-dashboards-reports`; el rediseño
  mobile-first, en `feature/home-topbar-redesign`.
- **Fecha:** 2026-11-10
- **Relacionado:** [ADR 0008](0008-funciones-independientes-por-area.md) (funciones por
  área), [ADR 0009](0009-navegacion-por-capacidades.md) (navegación)

## Contexto

Tras el ADR 0009, el Inicio mostraba tarjetas de acceso que repetían las opciones del
menú lateral. No aportaba información nueva.

## Decisión

### 1. Contenido del Inicio (rediseño mobile-first)

En una sola columna en móvil y con un ancho máximo de 60rem en escritorio:

1. **Saludo y acción principal.** «Hola, [nombre]» y «¿En qué podemos ayudarte hoy?».
   «Registrar incidencia» lleva al formulario existente: en móvil es un botón guinda de
   ancho completo; en escritorio, un botón discreto junto al saludo. Solo lo ven las
   cuentas operativas.
2. **Resumen** de las incidencias propias, en tres tarjetas en una fila (más compactas
   por debajo de 22rem). Cada incidencia está en un solo estado, así que no hay
   duplicados y la suma es el total:

   | Tarjeta | Estados reales |
   |---|---|
   | Pendientes | `registrada` + `reabierta` (esperan que el área programe la atención) |
   | En atención | `asignada` (programada, en curso o con seguimiento pendiente) |
   | Cerradas | `cerrada` (cierre técnico vigente) |

3. **Encuestas pendientes** (solo si existen): una tarjeta discreta con fondo cálido muy
   suave. «Evaluar atención» abre la encuesta existente del ticket más reciente
   (`?evaluar=1`); el ticket sale de `GET /incidents/survey-reminder/`, que se consulta
   sin marcar el recordatorio como mostrado. El recordatorio al iniciar sesión no cambia.
4. **Requiere tu atención** (solo con `can_attend`, `can_plan` o `can_verify`):
   - conteos compactos que llevan a cada bandeja;
   - la lista de tickets con su acción, como antes;
   - sin duplicar el menú.
5. **Mis incidencias recientes:** las 5 más recientes de `GET /incidents/?scope=mine`.
   - Muestran código, vista previa de la descripción, área, fecha relativa en hora de
     Lima y estado, con enlace al detalle y «Ver todas».
   - En móvil son tarjetas compactas; en escritorio, filas dentro de una tarjeta.
   - Hay un estado vacío claro.

**Exclusiones:** no hay actividad reciente ni próximas atenciones.

**Otras cuentas:** una cuenta exclusivamente administrativa sigue entrando al **Dashboard
general**, y una cuenta sin funciones ve el aviso para contactar al administrador.

**Vista previa de la descripción:** `GET /incidents/?scope=mine` devuelve
`description_preview`.
- Es la descripción original en una línea, de unos 100 caracteres, recortada con «…».
- Solo existe en la lista de incidencias propias: la lista del área (`scope=area`) no la
  incluye.
- No se añadieron columnas, migraciones ni endpoints.
- `has_attachments` se calcula en la misma consulta, sin una consulta por fila.

### 2. API de resumen: `GET /api/v1/incidents/summary/`

Un único endpoint de solo lectura, en lugar de varias llamadas a las bandejas, para que
el Inicio sea rápido y coherente. Devuelve los indicadores y los pendientes; no devuelve
actividad reciente.

- Se calcula con los mismos selectores de permisos que las bandejas existentes, así que
  nunca muestra más que ellas.
- Las secciones sin capacidad llegan como `null`.
- `surveys` trae las encuestas pendientes de las incidencias propias
  ([ADR 0012](0012-encuesta-de-satisfaccion.md)); es `null` sin una cuenta operativa.

| Indicador | Capacidad | Fuente (misma regla que la sección) |
|---|---|---|
| Mis incidencias abiertas y por estado | Cuenta operativa | `own_incidents`: lo que ve "Mis incidencias" |
| Encuestas pendientes | Cuenta operativa | Cierres vigentes sin evaluar de sus incidencias propias (ADR 0012) |
| Atenciones asignadas | `can_attend` | Asignación vigente de la persona, ticket `asignada`, en sus áreas de atención |
| Por programar | `can_plan` | Tickets `registrada` o `reabierta` de las áreas que planifica |
| Con atención pendiente | `can_plan` | `pending_queue`: última intervención En proceso o No solucionado |
| Cierres por verificar | `can_verify` | `verifiable_by`: cierres sin verificar de sus áreas, excluidos los que ejecutó |

### 3. Reglas de los datos

- **Sin duplicados.** Cada indicador cuenta tickets distintos.
  - En "Requiere tu atención" cada ticket aparece una sola vez, con una sola acción, por
    orden de prioridad: atender, verificar, planificar o revisar el seguimiento. Por
    ejemplo, un ticket asignado a la propia persona y con atención pendiente aparece
    como "Atender".
  - El total refleja los tickets distintos.
- **Solo datos registrados.**
  - Fechas: la programada (atender), la del cierre técnico (verificar) o la de registro
    (planificar).
  - No hay SLA, vencimientos ni estados inventados.

## Consecuencias

- El Inicio responde "qué tengo que hacer" sin repetir la navegación.
- El endpoint hace unas pocas consultas agregadas y limitadas: los conteos se hacen en
  la base de datos y solo se cargan los primeros elementos de cada lista.
- Las encuestas pendientes (Etapa 3, ADR 0012) aparecen como una tarjeta discreta del
  Inicio, que abre la encuesta existente.
