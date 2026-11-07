# ADR 0006: Atención, cierre técnico, verificación y reapertura

- **Estado:** propuesto. Implementado en `feature/incident-attention-workflow`.
- **Fecha:** 2026-11-07
- **Relacionado:** [ADR 0004](0004-planificacion.md) (planificación y permisos por área),
  [ADR 0005](0005-identificacion-qr.md) (evidencia fotográfica)

## Alcance

El ciclo empieza cuando el Planificador asigna una incidencia:

1. El **Personal de Atención** asignado registra intervenciones.
2. "Solucionado" produce el **cierre técnico**.
3. El **Planificador** verifica el cierre como Conforme o No conforme.
4. Si fue No conforme, puede **reabrir** la incidencia.

**No incluye:** inventario de repuestos, plazos (SLA), notificaciones ni integraciones
externas. Los repuestos se registran como texto descriptivo.

## 1. Tres dimensiones separadas

| Dimensión | Dónde se guarda | Valores |
|---|---|---|
| Estado operativo del ticket | `Incident.status` | `registrada`, `asignada`, `cerrada`, `reabierta` |
| Resultado de cada intervención | `IncidentIntervention.result` | `solved` (Solucionado), `in_progress` (En proceso), `not_solved` (No solucionado) |
| Resultado de cada verificación | `IncidentVerification.result` | `conforming` (Conforme), `not_conforming` (No conforme) |

"Pendiente de atención" y "Pendiente de verificación" **no son estados**: se derivan de
los datos, para no duplicar información.

- **Pendiente de atención:** la incidencia está `asignada` y la última intervención de su
  asignación vigente quedó En proceso o No solucionado.
- **Pendiente de verificación:** la incidencia está `cerrada` y su cierre vigente no tiene
  verificación.

## 2. Máquina de estados

```
registrada ──programar──▶ asignada ──intervención "Solucionado"──▶ cerrada
                            │  ▲                                    │
   "En proceso" / "No solu- │  │ reprogramar o reasignar            │ verificar
   cionado": sigue asignada ┘  │ (con motivo)                       ▼
                               │                     No conforme ──reabrir (motivo)──▶ reabierta
                               └──────────────────programar───────────────────────────────┘
```

| Transición | Quién | Condición |
|---|---|---|
| registrada o reabierta → asignada | Planificador del área | Técnico autorizado en el área |
| asignada → asignada (reprogramar o reasignar) | Planificador del área | Motivo obligatorio (ADR 0004) |
| asignada → asignada (intervención En proceso o No solucionado) | Técnico asignado ahora | Motivo obligatorio |
| asignada → cerrada | Técnico asignado ahora | Intervención Solucionado. **Sin aprobación previa** |
| cerrada → cerrada (verificar) | Planificador del área | Una verificación por cierre |
| cerrada → reabierta | Planificador del área | El cierre vigente se verificó como No conforme. Motivo obligatorio |

Cualquier otra transición se rechaza con **409**, también si llega como solicitud directa a
la API. PostgreSQL exige además que `cerrada` tenga un cierre vigente
(`incident_closed_has_closure`) y viceversa.

## 3. Intervenciones (`IncidentIntervention`)

- Cada intervención se vincula a la incidencia y a la **asignación vigente** cuando se
  registra, y guarda el técnico y la fecha de forma automática.
- **Campos:**

  | Campo | Regla |
  |---|---|
  | Diagnóstico técnico | Obligatorio |
  | Acciones realizadas | Obligatorio |
  | Resultado | Obligatorio |
  | ¿Se utilizaron repuestos? | Obligatorio, con su descripción si es Sí |
  | ¿Se requieren repuestos? | Obligatorio, con su descripción si es Sí |
  | Motivo | Obligatorio si no quedó Solucionado |
  | Observaciones | Opcionales |

- **Evidencia:** de 1 a 5 fotografías obligatorias. Se reutiliza el control de evidencias:
  tipo real, 5 MB, dimensiones, **eliminación de EXIF y GPS**, nombre aleatorio y descarga
  protegida. Las fotos técnicas (`IncidentAttachment.intervention`) solo las ve el
  personal del área. El solicitante recibe 404.
- **Inmutables:** no hay API para editarlas ni eliminarlas, y en el admin son de solo
  lectura. Una nueva atención es una intervención nueva.
- **Integridad en la base:** restricciones CHECK sobre el resultado, los textos
  obligatorios, el detalle de repuestos y el motivo.
- **Solucionado:** cierra el ticket. Fija `closing_intervention` (el cierre: quién y
  cuándo), termina la asignación vigente y registra los eventos `intervention` y `closed`.
- **En proceso o No solucionado:** el ticket sigue `asignada` y aparece en la cola
  **Pendientes de atención** del Planificador. Este puede reprogramar o reasignar
  justificadamente. El siguiente técnico ve el historial completo.

## 4. Verificación (`IncidentVerification`)

- Solo la registra un **Planificador del área** sobre el cierre vigente.
- Guarda el resultado, quién verificó, la fecha y las observaciones, que son obligatorias
  si el resultado es No conforme.
- **Una por cierre:** `OneToOne` con la intervención de cierre. Un segundo intento
  responde 409; las verificaciones nunca se sobrescriben.
- Puede registrarse días después. Mientras tanto, la incidencia **sigue cerrada**.

## 5. Reapertura

- Solo es posible tras una verificación **No conforme** del cierre vigente, y con un
  motivo de entre 10 y 2000 caracteres.
- El ticket pasa a `reabierta` y conserva su código. `closing_intervention` vuelve a estar
  vacío, pero **el cierre anterior y su verificación se conservan** en sus registros y en
  el historial: eventos `closed`, `verified` y `reopened`.
- El Planificador programa una nueva atención, con otro técnico o con el mismo. Esa
  atención tiene su propio resultado y su propia verificación.

## 6. Permisos (backend)

| Acción | Requisito |
|---|---|
| Ver la bandeja de atención (`GET /incidents/attention/`) | Rol `personal_atencion`. Solo sus asignaciones vigentes y lo que cerró, en áreas donde sigue autorizado |
| Registrar una intervención (`POST /incidents/<código>/interventions/`) | Ser el técnico de la **asignación vigente**, seguir autorizado en el área (rol más `can_be_assigned`), incidencia `asignada` y `assignment` igual a la asignación vigente (si no, 409) |
| Verificar (`POST .../verification/`) y reabrir (`POST .../reopen/`) | Rol `planificador` más `can_plan` en el área de la incidencia |
| Colas del Planificador | `GET /incidents/planning/?queue=pending` y `?queue=verification`, solo en sus áreas |

- Una incidencia que el usuario no puede ver responde **404**, para evitar IDOR.
- Las escrituras exigen CSRF.
- `permissions` en el detalle (`can_intervene`, `can_verify`, `can_reopen`) solo orienta
  la interfaz: el servicio vuelve a comprobar todo.

## 7. Concurrencia

Cada operación bloquea con `select_for_update(of=("self",))` la incidencia y, cuando
corresponde, la asignación vigente, dentro de una transacción. Si una intervención y una
reasignación llegan a la vez, una espera a la otra: la segunda ve el cambio y responde 409.
Hay una prueba con dos conexiones reales en PostgreSQL. Si algo falla, se revierte todo,
incluidos los archivos ya escritos.

## 8. Lo que ve el solicitante

- Ve el estado (Asignada, Cerrada, Reabierta), la fecha estimada y la fecha de cierre.
- **No ve** las intervenciones, las fotos técnicas, los repuestos, los motivos ni las
  verificaciones.
- En su historial aparecen el registro, la programación, el cierre y la reapertura, sin
  detalles.

## Migración `incidents.0006_attention_workflow`

| Operación | Efecto |
|---|---|
| `AlterField Incident.status` y `IncidentEvent.event_type` | Nuevas opciones, sin cambios en las columnas |
| `CreateModel IncidentIntervention` y `IncidentVerification` | Tablas nuevas con sus restricciones CHECK e índice |
| `AddField Incident.closing_intervention` | FK nula `OneToOne`. Las filas existentes quedan en NULL |
| `AddField IncidentAttachment.intervention` | FK nula. Las evidencias existentes son del registro |
| `AddConstraint incident_closed_has_closure` | Ninguna incidencia existente está `cerrada`, así que no hay conflicto |

No elimina columnas ni modifica datos.

## Pendiente de validar con Walter

1. Si el resultado Solucionado debe cerrar siempre sin aprobación. Está implementado así,
   como se confirmó.
2. Cuántas fotografías se permiten por intervención (hoy de 1 a 5) y su plazo de conservación.
3. Si el solicitante debe ver algo del resultado técnico o de la verificación.
4. Si un Planificador puede verificar una incidencia que él mismo atendió como técnico.
   Hoy se permite si tiene ambas funciones en el área.
5. Si la reapertura debe tener un plazo máximo después del cierre.
6. El catálogo de repuestos y su integración con el inventario (fuera de alcance).
7. Notificaciones al técnico, al Planificador y al solicitante (fuera de alcance).
