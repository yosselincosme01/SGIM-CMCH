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

### 3. Reglas en tres capas

| Capa | Qué aplica |
|---|---|
| **React** (`features/incidents/equipment.ts`) | Respuesta obligatoria. El código solo se pide y se envía con `qr_readable`. Al cambiar de opción se descarta el código. Valida longitud y caracteres para orientar al usuario |
| **Django REST Framework** (`identification.py`, serializer de registro) | Respuesta obligatoria entre las cuatro opciones públicas. Exige el código con `qr_readable` y lo rechaza en las demás opciones. Rechaza `asset_reference`, `qr_capture_method` y cualquier otro campo no autorizado (400). El servicio `create_incident` repite la validación |
| **PostgreSQL** (restricciones CHECK) | `incident_qr_status_valid`: el valor debe ser una opción conocida. `incident_qr_code_matches_status`: solo `qr_readable` lleva código no vacío, sin espacios en los extremos y con forma de captura; las demás opciones tienen código y forma de captura vacíos |

Los permisos de acceso no cambian. El QR solo lo ve quien ya puede ver la incidencia:
el solicitante autor y el personal del área con función autorizada (ADR 0004). Los
listados no incluyen el contenido del QR.

### 4. Forma de captura y escaneo futuro

- `qr_capture_method` registra cómo se obtuvo el código. Hoy siempre es `manual` y lo fija
  el servidor. El valor `scan` existe en el modelo y en la restricción de la base, pero
  **la API no lo acepta todavía**.
- En el frontend, `QrCodeInput` recibe el contenido mediante `onCode(texto, método)`. Un
  futuro lector con cámara se conectará a esa misma interfaz, sin cambiar el formulario.
- **No se muestran botones de escaneo** hasta que la función exista.

Requisitos para habilitar el escaneo con cámara, documentados para entonces:

1. **HTTPS obligatorio:** `getUserMedia` solo funciona en contextos seguros. En
   desarrollo, `localhost` es la excepción. Requiere el certificado definido con TI.
2. **Permiso de cámara:** lo concede el usuario en cada navegador. Si lo deniega o no hay
   cámara, se muestra un mensaje claro y se mantiene la entrada manual.
3. **Compatibilidad móvil:** probar en Chrome para Android y Safari para iOS, incluida la
   cámara trasera. `BarcodeDetector` no está disponible en todos los navegadores, por
   ejemplo en Safari. Hay que decidir entre esa API y una librería auditada y mantenida.
4. **Privacidad:** no se graban ni se envían imágenes de la cámara; solo el texto leído.
   La transmisión de la cámara se detiene al cerrar el lector.
5. La API habilitará `scan` solo cuando el lector exista, con sus pruebas.

### 5. Campo legado `asset_reference`

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
5. Cuándo, en qué dispositivos y con qué tecnología se habilitará el escaneo con cámara.
6. Cuándo eliminar `asset_reference` y qué hacer con sus datos heredados.
