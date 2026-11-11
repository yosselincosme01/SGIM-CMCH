# ADR 0008: Funciones operativas independientes por área

- **Estado:** propuesto. Implementado en `feature/admin-dashboards-reports`.
- **Fecha:** 2026-11-10
- **Relacionado:** [ADR 0002](0002-autenticacion-y-roles.md) (roles),
  [ADR 0004](0004-planificacion.md) (funciones por área),
  [ADR 0006](0006-atencion-verificacion.md) (verificación y reapertura),
  [ADR 0007](0007-administracion-reportes.md) (administración)

## Contexto

Hasta ahora, verificar la conformidad de un cierre técnico era parte de la función de
planificar (`can_plan`). La clínica necesita separar ambas cosas: quien programa la
atención no siempre es quien debe dar la conformidad, y nadie debería aprobar su propio
trabajo.

Además, registrar incidencias exigía el rol Solicitante. Un técnico o un Planificador
que detectaba una falla necesitaba un rol adicional solo para reportarla.

Los permisos ya los calcula siempre el backend con todos los roles y funciones del
usuario. La vista que la persona elige en la interfaz no da ni quita permisos. Este ADR
mantiene ese principio y lo extiende.

## Decisión

### 1. Tres funciones independientes por área

`SupportAreaMembership` tiene tres funciones. Todas empiezan en `False` y valen solo
para su área:

| Función (nombre en la administración) | Campo | Requisito de la cuenta |
|---|---|---|
| Planificar atenciones | `can_plan` | rol `planificador` |
| Registrar atenciones (recibir asignaciones) | `can_be_assigned` | rol `personal_atencion` |
| Verificar conformidad | `can_verify` (nuevo) | cualquier rol operativo; **no** exige `planificador` |

- **Independencia:** ninguna función se concede ni se retira por otra. Con
  `can_plan=True` y `can_verify=False`, la persona planifica pero no verifica. Con
  `can_verify=True` y `can_plan=False`, verifica los cierres de su área pero no
  planifica.
- **Criterio de autorización:** la función efectiva en el área. Planificar y registrar
  atenciones mantienen su rol global por compatibilidad (ADR 0004). Verificar solo exige
  que la cuenta sea operativa (activa y con algún rol operativo). Así, una persona con
  `can_verify` en TI verifica aunque no tenga el rol Planificador ni `can_plan`. **No se
  crea un rol Verificador** ni un sistema de permisos paralelo.
- Una función de otra área no da acceso. La pertenencia con `can_verify` en una cuenta
  sin rol operativo (sin roles o solo Administrador) tampoco.
- **Sin privilegios implícitos:** `is_superuser`, `is_staff` y el rol Administrador no
  conceden ninguna función. Una cuenta inactiva o un área inactiva tampoco.

### 2. Separación de funciones en la verificación

- Nadie verifica el cierre de una intervención que **ejecutó él mismo**, aunque tenga
  `can_verify` y también `can_plan` o `can_be_assigned` en el área. La API responde 403.
- La regla se aplica a la **intervención de cierre vigente**. Si el ticket se reabre y
  otra persona lo cierra, quien ejecutó el cierre anterior sí puede verificar el nuevo.
- Esos cierres no aparecen en su cola "Por verificar". El detalle informa
  `permissions.verification_blocked = "own_intervention"` para que la interfaz explique
  el motivo.

### 3. Reapertura

- Puede reabrir un cierre verificado como No conforme quien tiene **`can_plan` o
  `can_verify`** en el área. Así se conserva el flujo actual (el Planificador reabre y
  vuelve a programar) y quien verifica puede completar su propio ciclo.
- Siguen igual el motivo obligatorio, el historial (cierres, verificaciones y eventos
  anteriores se conservan) y el paso a `reabierta`, que espera una nueva programación.

### 4. Bandeja y visibilidad

- El personal ve en detalle las incidencias de las áreas donde tiene **alguna** función.
- Se reutilizan los endpoints actuales. `GET /incidents/planning/` y
  `/incidents/planning/options/` admiten el rol Planificador **o** la función de
  verificar en algún área. Verificar (`…/verification/`) y reabrir (`…/reopen/`) no
  exigen el rol: comprueban la función en el área del ticket. Planificar, priorizar,
  ver técnicos e indicadores siguen exigiendo el rol Planificador y `can_plan`.
- La bandeja del Planificador (`/incidents/planning/`) muestra:
  - todas las incidencias de las áreas donde planifica;
  - solo las cerradas de las áreas donde únicamente verifica.
- `queue=verification` y el contador `to_verify` incluyen solo los cierres que el
  usuario **puede** verificar.
- `GET /incidents/planning/options/` devuelve `functions`: las funciones del usuario por
  área.
- `GET /auth/me/` devuelve `capabilities` (`can_plan`, `can_attend`, `can_verify`): si
  la persona tiene cada función en alguna área. Solo adapta la interfaz. Con
  `can_verify`, la vista Planificador actual queda disponible aunque no tenga el rol; los
  indicadores del Planificador, no.

### 5. Funciones básicas de toda cuenta operativa

- Una **cuenta operativa** es una cuenta activa con al menos un rol operativo explícito:
  Solicitante, Planificador o Personal de atención (`OPERATIONAL_ROLES`).
- Toda cuenta operativa puede registrar incidencias y consultar las que registró, con
  su estado y su seguimiento. Las futuras encuestas de satisfacción se apoyarán en esta
  misma regla de "incidencias propias".
- No se concede acceso global: solo ve las ajenas quien tiene una función en esa área.
- **No pueden** registrar ni consultar incidencias propias:
  - las cuentas inactivas;
  - las cuentas sin rol operativo;
  - las cuentas exclusivamente administrativas (solo rol Administrador, superusuario o
    staff sin rol operativo).

### 6. Administración

- La API de usuarios (`/api/v1/admin/users/`) acepta y devuelve `can_verify` en cada
  pertenencia.
- El formulario muestra tres casillas por área: **Planificar atenciones**, **Registrar
  atenciones** y **Verificar conformidad**.
- Siguen vigentes las reglas del ADR 0007:
  - el Administrador no otorga el rol Administrador;
  - no modifica cuentas protegidas ni la suya;
  - planificar y registrar atenciones exigen su rol; verificar, solo algún rol
    operativo;
  - retirar el rol Planificador retira `can_plan`, pero no `can_verify` si queda otro
    rol operativo; retirar todos los roles operativos retira `can_verify`;
  - todo cambio queda en la auditoría con los valores anteriores y nuevos.

### 7. Migración de datos `incidents.0007_membership_can_verify`

- Añade `can_verify` con valor `False` y copia `can_plan` en `can_verify` **una sola
  vez**. Así nadie pierde el acceso de verificación que tenía.
- A partir de ahí, ambas funciones se gestionan por separado.
- No borra ni modifica incidencias, intervenciones, verificaciones, eventos ni
  auditoría.
- Es reversible: la vuelta atrás elimina la columna.

## Consecuencias

- Un Planificador existente conserva planificar y verificar tras la migración. Para
  separar las funciones, el Administrador desmarca una de las dos.
- Un usuario con varias funciones las ejerce todas a la vez, sin elegir una vista. La
  separación de funciones impide que apruebe su propio trabajo.
- Con solo `can_verify`, sin el rol Planificador, la persona trabaja desde la vista
  Planificador actual, que solo le muestra los cierres. El rediseño de la navegación
  queda para la siguiente etapa.
- La vista Solicitante ("registrar" y "mis incidencias") aparece para todo rol
  operativo. Por eso una persona con un solo rol operativo distinto de Solicitante ve
  ahora dos vistas.

## Pendiente de validar con Walter

1. Qué perfiles deben recibir `can_verify` en cada área (por ejemplo, la jefatura de
   la UPS solicitante). Hoy basta con cualquier rol operativo y la función en el área.
2. Si la separación de funciones debe abarcar también otras intervenciones del mismo
   ciclo o a quien asignó la atención. Hoy abarca solo al ejecutor del cierre vigente.
3. Quién debe poder reabrir: hoy, quien planifica o verifica en el área.
