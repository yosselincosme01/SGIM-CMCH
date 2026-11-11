# ADR 0009: Navegación unificada por capacidades

- **Estado:** propuesto. Implementado en `feature/admin-dashboards-reports`.
- **Fecha:** 2026-11-10
- **Relacionado:** [ADR 0007](0007-administracion-reportes.md) (administración),
  [ADR 0008](0008-funciones-independientes-por-area.md) (funciones por área)

## Contexto

La interfaz se organizaba en **vistas por rol** (Solicitante, Planificador, Personal de
Atención, Administrador). Quien tenía varios roles elegía la vista en un selector de la
cabecera. Esto tenía tres problemas:

- obligaba a conocer los roles internos;
- duplicaba accesos;
- ya no coincidía con la autorización real. Desde el ADR 0008, las funciones se conceden
  por área y de forma independiente; por ejemplo, alguien puede verificar sin ser
  Responsable de Área.

## Decisión

### 1. Un único menú, construido con los permisos efectivos

- El selector de vistas desaparece. Cada persona ve un solo menú lateral con todo lo que
  puede hacer, sin duplicados.
- **Fuente de verdad:** `frontend/src/features/navigation/access.ts`. La usa el menú y
  también la protección de rutas (`RequireAccess`). Así, la interfaz nunca ofrece algo
  que la ruta rechace, ni al revés.
- **Origen de los datos:** `GET /api/v1/auth/me/` devuelve
  - `capabilities` (`can_plan`, `can_attend`, `can_verify`);
  - `area_functions`: las funciones efectivas por área activa, que solo incluyen las que
    la persona puede ejercer de verdad, es decir, con el rol o la cuenta operativa que
    cada una exige.

| Grupo | Opción | Requisito |
|---|---|---|
| General | Inicio | Con sesión, salvo cuentas exclusivamente administrativas (su entrada principal es Dashboard general) |
| General | Registrar incidencia, Mis incidencias | Cuenta operativa: algún rol operativo |
| Operaciones | Mis atenciones | `can_attend` en algún área |
| Operaciones | Planificación | `can_plan` en algún área |
| Operaciones | Verificaciones | `can_verify` en algún área |
| Análisis | Indicadores | `can_plan` en algún área (alcance: sus áreas) |
| Análisis | Reportes | `can_plan` en algún área, o Administrador (alcance global) |
| Administración | Dashboard general, Consulta de incidencias, Usuarios y permisos, Auditoría | Administrador |

- **El nombre del rol no basta.** El rol Responsable de Área sin `can_plan` en ningún área
  no muestra Planificación. La única opción ligada a un rol es Administración, porque no
  tiene función por área.
- Las **encuestas de satisfacción** (Etapa 3) no aparecen hasta que existan: el menú no
  muestra enlaces vacíos.

### 2. Rutas por funcionalidad, no por rol

| Ruta | Funcionalidad |
|---|---|
| `/incidencias/nueva`, `/incidencias[/:code]` | Registro y Mis incidencias |
| `/atenciones[/incidencias/:code]` | Mis atenciones |
| `/planificacion[/incidencias/:code]` | Planificación |
| `/verificaciones[/incidencias/:code]` | Verificaciones |
| `/indicadores`, `/reportes` | Análisis |
| `/administracion`, `/administracion/incidencias[/:code]`, `/administracion/usuarios[…]`, `/administracion/auditoria` | Administración |
| `/mi-cuenta` | Datos de la cuenta y funciones por área, sin nombres de roles |

- Las rutas anteriores (`/solicitante`, `/planificador`, `/responsable-area`,
  `/personal-atencion`, `/administrador`) redirigen a las nuevas. La redirección **no
  amplía permisos**: la ruta de destino vuelve a comprobar el acceso.
- La protección en el frontend es solo de navegación. El backend sigue aplicando todos
  los permisos en cada endpoint.

### 3. Inicio

- **Cuenta operativa:** dashboard operativo con indicadores, pendientes y actividad
  reciente ([ADR 0010](0010-inicio-dashboard-operativo.md)). Sustituye a las tarjetas de
  acceso, que repetían el menú.
- **Cuenta exclusivamente administrativa:** va directamente al Dashboard general. Su menú
  no muestra "Inicio", porque sería la misma pantalla; el grupo Administración aparece
  primero y el logotipo enlaza al Dashboard general.
- **Cuenta administrativa y operativa:** ve "Inicio" (dashboard operativo) y "Dashboard
  general" (panel administrativo), con contenidos distintos.
- **Cuenta sin funcionalidades:** aviso para contactar al administrador.

### 4. Planificación y Verificaciones separadas

- Reutilizan los endpoints actuales. `GET /incidents/planning/` acepta
  `function=plan|verify`, que limita la consulta a las áreas de esa función. El filtro
  nunca amplía el alcance: solo lo reduce.
- **Planificación** (`function=plan`) ya no incluye la cola "Cerradas por verificar".
- **Verificaciones** (`function=verify`) muestra dos vistas:
  - "Por verificar": cierres que la persona puede verificar; no incluye los que ejecutó;
  - "Todos los cierres".
- El detalle es el mismo componente (`PlanningDetailPage`) en modo `plan` o `verify`. En
  Verificaciones solo se ofrece el panel del cierre técnico. Las acciones disponibles las
  calcula siempre el backend (`permissions`), incluida la separación de funciones.
- Se corrige `pending_verification` en la bandeja: el serializer lo leía, pero nunca se
  calculaba.

### 5. Nombre visible: "Responsable de Área"

- La función del trabajador se muestra como **Responsable de Área** en toda la interfaz,
  incluida la etiqueta del rol en la gestión de usuarios. Las acciones se llaman
  **Planificación** y **Verificaciones**.
- El identificador técnico `planificador` no cambia, así que no hay migración.
- Esto revierte la decisión del 2026-11-06, que había fijado "Planificador".

### 6. Administración reorganizada

Todas las secciones reutilizan endpoints existentes, salvo la consulta global.

- **Dashboard general:** indicadores globales (ADR 0007).
- **Consulta de incidencias:** endpoint nuevo, de solo lectura: `GET
  /api/v1/admin/incidents/` y `GET /api/v1/admin/incidents/<código>/`.
  - **Muestra:** todas las áreas, con filtros por área, estado, prioridad y texto. El
    detalle incluye datos, historial, intervenciones (texto) y verificaciones.
  - **No muestra:** fotografías ni enlaces de descarga, solo cuántas hay. La descarga
    protegida sigue exigiendo una función en el área.
  - **No permite:** acciones. No devuelve `permissions` y rechaza los métodos de
    escritura (405).
  - **Datos personales:** incluye el nombre del solicitante, igual que los reportes.
- **Usuarios y permisos:** sin cambios funcionales (ADR 0007 y 0008).
- **Reportes:** página propia en Análisis. `MetricsPanel` se divide en los modos
  `indicators` y `reports`.
- **Auditoría:** consulta de `GET /api/v1/admin/audit/`, filtrable por operación.
  `admin/options` devuelve las acciones disponibles.
- El Administrador sigue **sin** capacidades operativas: no planifica, no atiende y no
  verifica.

### 7. Layout y accesibilidad

- **Encabezado guinda:**
  - el logotipo institucional sigue en el extremo izquierdo;
  - le siguen la identidad SGIM-CMCH y el botón del menú;
  - a la derecha, el nombre de la persona (enlace a Mi cuenta) y "Cerrar sesión".
- **Escritorio:** menú lateral siempre visible, con grupos titulados, ancho fijo y
  desplazamiento vertical propio. No hay botón para ocultarlo.
- **Tabletas y móviles (hasta 56rem):** el menú es un panel superpuesto.
  - Se abre con el botón "Menú", y el foco pasa a la primera opción.
  - Se cierra con Escape (el foco vuelve al botón), tocando fuera o al elegir una opción.
- **Accesibilidad:**
  - opción activa con `aria-current="page"`, marcada también con borde y fondo, no solo
    con color;
  - botón con `aria-expanded` y `aria-controls`;
  - enlace "Saltar al contenido";
  - menú oculto con `hidden`, para que no reciba el foco.

## Consecuencias

- Las personas no necesitan conocer los roles internos.
- Quien tiene varias funciones las usa todas sin cambiar de vista.
- Los enlaces guardados con las rutas anteriores siguen funcionando.
- La consulta global del Administrador amplía lo que este puede ver. Es solo lectura y
  sin evidencias, y queda pendiente de validar con Walter (ADR 0007).

## Pendiente de validar con Walter

1. Si la consulta global del Administrador debe quedar registrada en la auditoría. Hoy
   no se registran las consultas, solo las operaciones y las descargas.
2. Si "Mi cuenta" debe permitir cambiar la contraseña propia. Hoy es solo consulta.
3. Si las encuestas de satisfacción (Etapa 3) deben aparecer en "General" para todas las
   cuentas operativas.
