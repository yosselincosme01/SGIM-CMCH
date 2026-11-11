# ADR 0012: Encuesta de satisfacción por cierre técnico

- **Estado:** propuesto. Implementado en `feature/admin-dashboards-reports`.
- **Fecha:** 2026-11-10
- **Relacionado:** [ADR 0006](0006-atencion-verificacion.md) (cierre, verificación y
  reapertura), [ADR 0008](0008-funciones-independientes-por-area.md) (funciones por área),
  [ADR 0011](0011-panel-de-administracion.md) (panel e indicadores)

## Contexto

La clínica quiere conocer la opinión del solicitante sobre la atención recibida. Ya
existe la **verificación técnica**: el Responsable de Área registra si un cierre es
Conforme o No conforme (ADR 0006).

Son dos cosas distintas:

| | Satisfacción del solicitante | Verificación técnica |
|---|---|---|
| Quién | Quien registró la incidencia | Quien tiene `can_verify` en el área |
| Qué valora | Su experiencia con la atención (1 a 5 y comentario) | Si el trabajo técnico quedó bien |
| Obligatoria | No, voluntaria | Es parte del flujo |
| Efecto en el ticket | Ninguno | "No conforme" permite reabrir |

## Decisión

### 1. Una encuesta por cierre técnico

- **Modelo `incidents.SatisfactionSurvey`:**
  - incidencia;
  - cierre técnico evaluado (`closing_intervention`, `OneToOne`, la intervención
    "Solucionado");
  - quién respondió;
  - calificación y comentario opcional (hasta 1000 caracteres);
  - fecha de respuesta.
- El ciclo de atención se identifica por su intervención de cierre, igual que la
  verificación. Así, una evaluación pertenece a un cierre concreto y no solo al número de
  ticket.
- **Integridad en la base de datos:** una sola encuesta por cierre (`OneToOne`) y
  calificación entre 1 y 5 (`CheckConstraint`). Es de solo adición: no hay API para
  editar ni borrar, y en el admin de Django es de solo lectura.
- **Migración:** `incidents.0008_satisfaction_survey`. Solo crea la tabla; no toca datos
  existentes.

### 2. Reglas

- **Voluntaria.** Nunca se envía en nombre del solicitante. El modal no se abre solo: lo
  abre el botón «Evaluar atención».
- **Solo el cierre vigente.** Se puede evaluar el cierre técnico vigente de una
  incidencia cerrada, sin esperar la verificación.
  - Si el ticket se reabre antes de responder, ese cierre deja de ser evaluable.
  - Una evaluación ya enviada se conserva siempre.
  - Un nuevo cierre habilita una nueva encuesta.
- **Solo el solicitante original**, con una cuenta operativa activa. A quien no ve la
  incidencia se le responde 404; a quien la ve sin haberla registrado, 403.
- **Una vez por cierre.**
  - El servicio bloquea la incidencia (`select_for_update`), comprueba que no exista una
    respuesta y guarda.
  - Si dos envíos coinciden, la base de datos rechaza el segundo y se responde 409.
  - El envío incluye el cierre que la persona vio (`closure`). Si cambió entretanto,
    también se responde 409.
- **Independiente de la verificación.** Enviar una encuesta no cambia el estado, no
  registra conformidad, no reabre y no añade eventos al historial del ticket.

### 3. API

- `GET /api/v1/incidents/<código>/survey/`: el cierre vigente pendiente de evaluar (o
  `null`) y las evaluaciones anteriores del solicitante.
- `POST /api/v1/incidents/<código>/survey/`: envía `closure`, `rating` (1 a 5) y
  `comment` (opcional). Exige CSRF y rechaza campos desconocidos.
- `GET /incidents/?scope=mine`: incluye `survey_pending` en cada fila.
- `GET /incidents/summary/` (Inicio): incluye `surveys.pending`.

### 3 bis. Recordatorio al iniciar sesión

- **Qué muestra:** al entrar al área autenticada, se consulta una sola vez
  `GET /api/v1/incidents/survey-reminder/`. La respuesta incluye `show`, el total y hasta
  5 tickets con cierre vigente sin evaluar en incidencias propias.
  - Con una pendiente: un modal con el ticket, «Ahora no» y «Evaluar atención». Este
    botón abre el ticket con la encuesta existente (`?evaluar=1`), sin duplicar el
    componente.
  - Con varias: un solo modal con la cantidad, la lista breve y «Ver mis incidencias».
- **Una vez por sesión:** al mostrarse, `POST` al mismo endpoint guarda la marca **en la
  sesión de Django (servidor)**.
  - Navegar, recargar o abrir otra pestaña no lo repite.
  - Un nuevo inicio de sesión crea una sesión nueva, así que vuelve a mostrarse si sigue
    pendiente.
  - Al cambiar de cuenta o al expirar la sesión, la marca desaparece, y el componente se
    reinicia por usuario. Un usuario nunca ve el recordatorio de otro.
  - No se usa `localStorage` ni `sessionStorage`, como el resto de la autenticación.
- **Peticiones pasivas:** el endpoint es `session_passive`, así que no renueva la
  inactividad. «Ahora no» y Escape cierran sin registrar ninguna respuesta.
- **A quién se muestra:** a toda cuenta operativa con incidencias propias pendientes de
  evaluar, aunque también planifique, atienda o verifique. A las cuentas sin rol
  operativo (por ejemplo, solo administrativas) ni siquiera se les consulta.
- **Acceso permanente:** se mantiene en Inicio («Encuestas pendientes») y en Mis
  incidencias («Evaluación pendiente»).

### 4. Quién ve las evaluaciones individuales

- **El solicitante:** las suyas, en «Mis incidencias».
- **Responsable de Área:** las de su área, en el detalle del ticket (`surveys`).
  - Solo si tiene la función de planificar o de verificar en el área de esa incidencia.
  - El rol, por sí solo, no basta.
  - Un técnico recibe la lista vacía.
- **Administrador:** todas, en la consulta global de solo lectura.
- **Indicadores:** no hay indicadores por técnico.

### 5. Indicadores y reporte

`reports/dashboard` añade el bloque `satisfaction`. Tiene el mismo alcance (Administrador:
global; Responsable de Área: sus áreas con `can_plan`) y los mismos filtros de área y
periodo (fecha de registro, hora de Lima) que el resto de indicadores.

| Dato | Cálculo |
|---|---|
| `eligible` | Cierres técnicos (intervenciones "Solucionado") de las incidencias del alcance. Cada cierre cuenta una vez, aunque el ticket se haya reabierto |
| `answered` | Encuestas respondidas sobre esos cierres |
| `pending` | Cierres vigentes sin respuesta (todavía evaluables) |
| `expired` | Cierres sin respuesta que dejaron de ser evaluables al reabrirse |
| `average` | Promedio de las calificaciones respondidas; `null` sin respuestas |
| `response_rate` | `answered / eligible × 100`; `null` sin cierres |

Una encuesta no respondida **no** cuenta como insatisfacción.

**Dónde se muestran:**
- en el Panel de Administración, en Indicadores del Responsable de Área y en Reportes;
- solo cuando hay cierres en el periodo;
- el promedio y la tasa, solo cuando hay respuestas.

**Reporte Excel «Satisfacción del solicitante»** (`/reports/satisfaction/export/`), dentro
de Reportes:
- una fila por cierre técnico, con su estado: Respondida, Pendiente o No evaluada
  (reabierta);
- calificación, comentario y fecha de respuesta;
- la protección contra fórmulas y el límite de filas existentes;
- cada descarga queda en la auditoría.

## Consecuencias

- La reapertura conserva intacta la evaluación anterior, y cada ciclo puede tener la suya.
- La tasa de respuesta baja si los tickets se reabren antes de que el solicitante
  responda. Es lo esperado, porque esos cierres fueron elegibles.
- No hay notificaciones externas. El solicitante ve el recordatorio una vez por sesión,
  la invitación en el detalle, la marca «Evaluación pendiente» en Mis incidencias y el
  indicador en Inicio.

## Pendiente de validar con Walter

1. Si debe haber un plazo máximo para responder la encuesta de un cierre vigente.
2. Si el reporte debe anonimizar el comentario según la política de datos de la clínica.
   Hoy se exporta junto con el código del ticket.
