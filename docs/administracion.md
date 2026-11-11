# Administración del SGIM: procedimientos

Las reglas de diseño están en el [ADR 0007](adr/0007-administracion-reportes.md).

## 1. Crear un Administrador (solo TI)

Las cuentas administrativas **no** se crean desde la aplicación. TI las crea en el
servidor, con acceso a la consola.

1. Abre PowerShell en `backend\` y activa el entorno virtual:

   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```

2. Comprueba a qué base apunta Django, sin ver secretos:

   ```powershell
   python -c "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings.dev'); import django; django.setup(); from django.conf import settings; print(settings.DATABASES['default']['NAME'])"
   ```

3. Crea la cuenta. La contraseña se pide dos veces de forma interactiva y no queda en el
   historial de la consola:

   ```powershell
   python manage.py create_sgim_admin --username nombre.apellido --first-name Nombre --last-name Apellido --email correo@institucion
   ```

La cuenta creada tiene solo el rol `administrador`. **No** es superusuario ni staff y
no tiene roles operativos. La creación queda en la auditoría como "Procedimiento
técnico (TI)".

El comando no modifica cuentas existentes: si el usuario ya existe, se detiene. Para
dar de baja a un Administrador, TI lo desactiva desde el admin de Django con una cuenta
de soporte técnico.

## 2. Gestión diaria (Administrador)

Desde **Administración → Usuarios y permisos**:

- **Nuevo usuario:** datos, contraseña inicial (con las reglas del sistema), roles y
  autorizaciones por área.
- **Autorizaciones por área:** son tres e independientes
  ([ADR 0008](adr/0008-funciones-independientes-por-area.md)):
  - **Planificar atenciones:** requiere el rol Responsable de Área.
  - **Registrar atenciones:** recibir asignaciones; requiere Personal de Atención.
  - **Verificar conformidad:** requiere cualquier rol operativo, no el rol Responsable de Área.

  Marcar una no marca las demás. Nadie verifica el cierre de una atención que realizó.
- Toda cuenta con un rol operativo puede registrar incidencias y seguir las suyas. No
  hace falta darle el rol Solicitante solo para eso.
- **Editar:** datos, roles y autorizaciones por área. El nombre de usuario no se cambia.
- **Desactivar o activar** (con confirmación). No es posible si la persona tiene
  asignaciones vigentes: primero el Responsable de Área debe reasignarlas.
- **Restablecer acceso:** define una contraseña nueva y comunícala por un canal seguro.
  Las sesiones abiertas de esa cuenta se cierran.

Las cuentas protegidas (Administradores, superusuarios y staff) se muestran solo para
consulta.

## 3. Indicadores y reportes

- **Administrador:** en **Administración → Dashboard general** (Panel de Administración,
  [ADR 0011](adr/0011-panel-de-administracion.md)) ve los indicadores, las
  distribuciones por estado y por área y las incidencias recientes de todas las áreas,
  filtrables por periodo y área. En **Análisis → Reportes** descarga los reportes Excel.
- **Responsable de Área:** en **Análisis → Indicadores** y **Análisis → Reportes** ve solo
  las áreas que planifica.
- **Filtros:** fecha de registro (hasta 366 días), área y estado.
- **Satisfacción del solicitante:** promedio, respondidas, pendientes y tasa de
  respuesta, y el reporte Excel «Satisfacción del solicitante»
  ([ADR 0012](adr/0012-encuesta-de-satisfaccion.md)). Es la opinión voluntaria del
  solicitante, distinta de la verificación técnica.
- **Límite:** 5000 filas por descarga.
- Cada descarga queda en la auditoría.

## 4. Consulta de incidencias y auditoría

- **Administración → Consulta de incidencias:** todas las incidencias, en modo lectura
  ([ADR 0009](adr/0009-navegacion-por-capacidades.md)), con búsqueda por ticket y filtros
  por área, estado y periodo. Sin fotografías ni evidencias y sin acciones de
  planificación, atención o verificación.
- **Administración → Auditoría:** operaciones administrativas registradas, filtrables
  por operación. No se pueden modificar ni borrar.

## 5. Probar con cuentas ficticias (entorno de desarrollo)

**Requiere tu autorización**, porque crea una cuenta en `sgim_app`:

1. Crea un Administrador ficticio con el procedimiento técnico. Por ejemplo, con el
   usuario `admin.ficticio`.
2. Inicia sesión con esa cuenta y entra en **Administrador**.
3. Crea un usuario ficticio, por ejemplo `tecnico.ficticio`, con el rol Personal de
   Atención y la autorización "Registrar atenciones" en TI. Crea también
   `verificador.ficticio`, con el rol Solicitante y solo "Verificar conformidad" en TI.
4. Comprueba que:
   - no aparece la opción de rol Administrador;
   - la cuenta de `eva.prueba` (administradora existente) se muestra como protegida;
   - al desactivar la cuenta ficticia, ya no puede iniciar sesión;
   - la auditoría (`GET /api/v1/admin/audit/`) registra cada acción;
   - `verificador.ficticio` puede verificar un cierre de TI, pero no programar atenciones.
5. Descarga un reporte y ábrelo en Excel.
