# ADR 0010: Inicio como dashboard operativo personal

- **Estado:** propuesto. Implementado en `feature/admin-dashboards-reports`.
- **Fecha:** 2026-11-10
- **Relacionado:** [ADR 0008](0008-funciones-independientes-por-area.md) (funciones por
  área), [ADR 0009](0009-navegacion-por-capacidades.md) (navegación)

## Contexto

Tras el ADR 0009, el Inicio mostraba tarjetas de acceso que repetían las opciones del
menú lateral. No aportaba información nueva.

## Decisión

### 1. Contenido del Inicio

El Inicio deja de repetir el menú y muestra solo dos bloques, más un botón:

1. **Resumen:** indicadores compactos, cada uno enlazado a su sección. Solo aparecen los
   de las capacidades que la persona tiene.
   - **Encuestas pendientes** ([ADR 0012](0012-encuesta-de-satisfaccion.md)): solo si hay
     cierres vigentes sin evaluar en incidencias propias; lleva a "Mis incidencias".
2. **Requiere tu atención:** tickets reales que necesitan una acción de la persona, con
   su estado, la fecha que corresponde y un enlace a la operación (Atender, Verificar,
   Planificar o Revisar).
   - Solo aparece si la persona tiene alguna función operativa.
   - Muestra hasta 10 tickets y avisa si hay más.
   - Sin pendientes, muestra un estado vacío sencillo.
3. **Botón «Registrar incidencia»:** discreto (secundario), junto al encabezado. Solo lo
   ven las cuentas autorizadas para registrar.

**Exclusiones:** no hay actividad reciente ni próximas atenciones, para mantener el Inicio
simple.

**Otras cuentas:** una cuenta exclusivamente administrativa sigue entrando al **Dashboard
general**, y una cuenta sin funciones ve el aviso para contactar al administrador.

### 2. API de resumen: `GET /api/v1/incidents/summary/`

Un único endpoint de solo lectura, en lugar de varias llamadas a las bandejas, para que
el Inicio sea rápido y coherente. Devuelve los indicadores y los pendientes; no devuelve
actividad reciente.

- Se calcula con los mismos selectores de permisos que las bandejas existentes, así que
  nunca muestra más que ellas.
- Las secciones sin capacidad llegan como `null`.
- `surveys` trae las encuestas pendientes de las incidencias propias (ADR 0012).

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
- Las encuestas pendientes (Etapa 3) se muestran como otro indicador del resumen.
