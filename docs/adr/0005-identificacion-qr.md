# ADR 0005: Identificación del equipo mediante QR

- **Estado:** propuesto. Implementado en `feature/incident-qr-identification`. El formato
  de los QR y su validación contra el inventario están **pendientes de validar con Walter**.
- **Fecha:** 2026-11-07
- **Relacionado:** [ADR 0003](0003-incidencias.md) (registro), [ADR 0004](0004-planificacion.md) (permisos por área)

## Contexto

El formulario de registro tenía un campo libre opcional, "Equipo o activo". Se reemplaza
por una sección **"Identificación del equipo"**, preparada para relacionar más adelante
las incidencias con el inventario institucional autorizado mediante el QR de cada equipo.

## Decisiones

### 1. Pregunta obligatoria con cuatro respuestas

"¿El equipo tiene código QR?":

| Valor | Etiqueta | Contenido del QR |
|---|---|---|
| `qr_readable` | Tiene QR y puedo leerlo | **Obligatorio** |
| `qr_unreadable` | Tiene QR, pero no puedo leerlo | No se registra |
| `no_qr` | El equipo no tiene QR | No se registra |
| `not_equipment` | No corresponde a un equipo (infraestructura o instalaciones) | No se registra |
| `unspecified` | Sin dato de identificación (incidencia anterior) | Solo para filas anteriores a esta migración. **La API no lo acepta** |

No hay un campo independiente de número patrimonial ni de número de equipo.

**Interfaz mobile-first (revisión del 2026-11-07).** El formulario agrupa las cuatro
respuestas en dos opciones principales, con tarjetas táctiles de al menos 48 px y en una
sola columna en el celular:

| Opción en pantalla | Valor guardado |
|---|---|
| **Escanear QR · Usar cámara** (o **Código QR · Escribir el contenido** si no hay cámara) | `qr_readable` |
| **No tiene QR / No aplica**, con un motivo obligatorio | `qr_unreadable`, `no_qr` o `not_equipment` |

Las cuatro categorías y `unspecified` no cambian en la base de datos.

### 2. Tratamiento del contenido del QR

- **No se asume ningún formato** ni se interpreta el contenido.
- Se guarda el texto leído, sin espacios en los extremos y con un máximo de 255 caracteres.
- Se rechazan los caracteres de control, como saltos de línea, tabulaciones o NUL, y los de
  formato invisibles, como las marcas de dirección o los espacios de ancho cero, que permiten
  disfrazar un texto al mostrarlo.
- **Nunca se abre automáticamente una URL contenida en el QR.** Se muestra como texto
  literal, sin enlace y en tipografía monoespaciada. El servidor tampoco la consulta.
- **No se asocia el QR con equipos institucionales.** No existe un catálogo de equipos ni
  se inventan relaciones. Validar el QR contra el inventario autorizado queda pendiente.
- Un mismo QR puede aparecer en varias incidencias: no es único. Un índice parcial sobre
  `qr_code` (filas con código) prepara las consultas por equipo.

### 3. Fotografía obligatoria sin QR legible

Con `qr_unreadable`, `no_qr` o `not_equipment` es **obligatorio adjuntar una
fotografía** de la incidencia, por ejemplo una puerta rota, una luminaria dañada o un
equipo sin etiqueta. Con `qr_readable` sigue siendo opcional.

- Se exige en React, en el serializer (400 en `photo`) y en el servicio
  `create_incident`, así que una solicitud directa a la API no puede saltarse la regla.
- La foto pasa por el mismo mecanismo de siempre: tipo real (JPG, PNG o WebP), máximo
  5 MB, límites de dimensiones y **eliminación de metadatos** como EXIF y GPS.
- No se exige en PostgreSQL: la evidencia está en otra tabla y se guarda en la misma
  transacción. Una restricción entre tablas complicaría el esquema sin aportar seguridad
  real, porque solo el servicio crea incidencias.

### 4. Reglas en tres capas

| Capa | Qué aplica |
|---|---|
| **React** (`features/incidents/equipment.ts`, `EquipmentIdentification.tsx`) | Opción y motivo obligatorios. El código y la forma de captura solo se envían con `qr_readable`. Al cambiar de opción se descartan el código y el motivo. Exige la foto sin QR legible. Valida longitud y caracteres para orientar al usuario |
| **Django REST Framework** (`identification.py`, serializer de registro) | Respuesta obligatoria entre las cuatro opciones públicas. Exige el código con `qr_readable` y lo rechaza en las demás opciones. Acepta `qr_capture_method` solo como `manual` o `scan` y solo con `qr_readable`. Exige la foto sin QR legible. Rechaza `asset_reference` y cualquier otro campo no autorizado (400). El servicio `create_incident` repite la validación |
| **PostgreSQL** (restricciones CHECK) | `incident_qr_status_valid`: el valor debe ser una opción conocida. `incident_qr_code_matches_status`: solo `qr_readable` lleva código no vacío, sin espacios en los extremos y con forma de captura; las demás opciones tienen código y forma de captura vacíos |

Los permisos de acceso no cambian. El QR solo lo ve quien ya puede ver la incidencia:
el solicitante autor y el personal del área con función autorizada (ADR 0004). Los
listados no incluyen el contenido del QR.

### 5. Escaneo con la cámara (implementado)

- **Lector:** `BarcodeDetector`, la API nativa del navegador (Chrome para Android). Si no
  está disponible, como en Safari para iPhone o en Firefox, se usa **jsQR 1.4.0**: licencia
  Apache-2.0, sin dependencias, gratuita. Se carga en un archivo aparte **solo cuando hace
  falta**.
- **Cuándo se ofrece:** solo si el navegador expone la cámara en un **contexto seguro**
  (HTTPS o `localhost`). En HTTP, o sin soporte, la opción se presenta como "Código QR ·
  Escribir el contenido" y no aparece ningún botón de cámara. No se intenta evitar las
  restricciones del navegador.
- **Flujo:** "Abrir cámara" pide el permiso con `getUserMedia`, preferentemente la cámara
  trasera, y muestra la vista de escaneo con el botón **Cancelar**. Al detectar un QR se
  cierra la vista, se libera la cámara y el contenido completa el campo como texto.
- **Errores:** permiso denegado, sin cámara, cámara ocupada o contexto inseguro se
  explican en un aviso y el foco pasa al ingreso manual, que siempre está disponible,
  también para etiquetas deterioradas.
- **Seguridad:** el contenido leído pasa por las mismas validaciones que el escrito.
  Nunca se abre ni se ejecuta, aunque sea una URL. No se graban ni se envían imágenes de
  la cámara.
- **Pruebas desde un celular:** [docs/pruebas-movil.md](../pruebas-movil.md), con HTTPS
  local mediante mkcert y sin dependencias en el proyecto.

### 6. Forma de captura (`qr_capture_method`): dato declarado

- Es `scan` si el contenido lo leyó la cámara, y `manual` si se escribió o si el usuario
  corrigió el texto leído. El frontend lo envía junto con el código.
- **El servidor no puede verificar** que el código se haya leído realmente con la cámara:
  cualquier cliente podría declarar `scan`. Por eso solo comprueba que el valor sea
  conocido (`manual` o `scan`) y coherente, es decir, solo con `qr_readable`.
- Se documenta como **dato informativo del cliente, sin valor de seguridad ni de
  auditoría**. Si no se envía con un QR legible, se registra `manual`.

### 7. Campo legado `asset_reference`

- Se **conserva en la base de datos** con sus datos, sin cambios en la columna.
- Se retira del formulario, del contrato de registro y de todas las respuestas de la API.
- No se usa en registros nuevos, que lo dejan vacío. En el admin solo se puede consultar.
- **Eliminación futura:** en una migración aparte, cuando se defina la integración con el
  inventario institucional. Antes habrá que decidir qué hacer con los valores heredados:
  conservarlos en otro lugar o relacionarlos con el inventario.

## Migración `incidents.0005_incident_qr_identification`

| Operación | Efecto |
|---|---|
| `AlterField asset_reference` | Solo cambian la etiqueta, la ayuda y `editable`. **No se toca la columna ni sus datos** |
| `AddField equipment_qr_status` | Las filas existentes reciben `unspecified`. La columna queda sin valor por defecto |
| `AddField qr_code`, `AddField qr_capture_method` | Columnas vacías |
| `AddIndex incident_qr_code_idx` | Índice parcial sobre `qr_code` (filas con código) |
| `AddConstraint` (×2) | Las restricciones CHECK descritas en la sección 3 |

- No elimina datos.
- Es reversible: al revertirla se eliminan los campos nuevos y `asset_reference` queda igual.
- Hay una prueba automática de ida y vuelta que crea una incidencia anterior con
  `asset_reference`, aplica la migración y comprueba que queda `unspecified` y conserva su
  valor legado.

## Pendiente de validar con Walter

1. El formato oficial y el contenido de los QR del inventario.
2. La validación del QR contra el inventario autorizado y en qué momento se hace (al
   registrar o después).
3. Si las incidencias de infraestructura necesitan un dato de ubicación propio.
4. Si se debe avisar cuando ya hay una incidencia abierta para el mismo QR.
5. En qué dispositivos institucionales se usará el escaneo y si TI aprueba el certificado HTTPS del servidor.
6. Cuándo eliminar `asset_reference` y qué hacer con sus datos heredados.
7. Si conviene permitir más de una fotografía por incidencia cuando no hay un QR legible.
