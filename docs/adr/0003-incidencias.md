# ADR 0003: Registro y consulta de incidencias (primera etapa)

- **Estado:** propuesto. Implementado en `feature/incidents`, con reglas pendientes de validar con Walter.
- **Fecha:** 2026-11-06

## Alcance

Esta etapa cubre el registro de incidencias por el solicitante y su consulta: propias y,
en el backend, por área de soporte. **No incluye** asignación, atención técnica, revisión
ni encuesta de satisfacción.

## Módulos (monolito modular)

| App | Responsabilidad |
|---|---|
| `apps.catalogs` | `CareUnit` (UPS/servicio): catálogo **ajeno al usuario**, preparado para el catálogo autorizado |
| `apps.incidents` | `SupportArea`, `SupportAreaMembership`, `Incident`, `IncidentAttachment`, `IncidentEvent`; servicios, selectores, permisos y API |

En `apps.incidents`, cada capa vive en su propio archivo:

| Capa | Archivo |
|---|---|
| Modelos | `models.py` |
| Casos de uso (escrituras) | `services.py` |
| Consultas según permisos | `selectors.py` |
| Validación de adjuntos | `attachments.py` |
| Datos de entrada y salida | `serializers.py` |
| Endpoints | `views.py` |

## Decisiones

### Datos de registro

| Campo | Obligatorio | Notas |
|---|---|---|
| UPS / servicio (`care_unit`) | Sí | Se elige en cada incidencia; el usuario **no** tiene UPS asignada |
| Área de soporte (`support_area`) | Sí | TI, Ingeniería Clínica o Mantenimiento (creadas por la migración `0002`) |
| Descripción del problema | Sí | Entre 10 y 2000 caracteres. Lo que se observa, **sin diagnóstico técnico** |
| Acciones previas | No | Hasta 1000 caracteres |
| Equipo o activo (`asset_reference`) | No | Texto libre, hasta 100 caracteres. **Sin** integración con inventario ni lectura QR |
| Fotografía | No | Una imagen JPG, PNG o WebP, hasta 5 MB |

El autor (`created_by`), el código, el estado y las fechas los fija el servidor. Si el
formulario envía cualquiera de esos campos, la API responde **400**.

### Catálogo de UPS

- No existe todavía un catálogo autorizado. El modelo `CareUnit` usa `code` como
  identificador estable, y tiene los campos `is_active` (activa o no) e `is_demo`
  (dato de demostración).
- Los datos de demostración solo se cargan con `python manage.py seed_demo_care_units`:
  son 6 UPS con el prefijo `[DEMO]`. Ninguna migración carga datos ficticios.

### Código de la incidencia

- Formato: `INC-<año>-<número>`, por ejemplo `INC-2026-000123`. El número es la clave
  primaria, que genera la secuencia de la base de datos.
- Dos registros simultáneos **no pueden** recibir el mismo código, y además hay una
  restricción `UNIQUE` en la columna. El código se asigna en la misma transacción que el `INSERT`.
- La numeración **no se reinicia** cada año: el año solo indica cuándo se registró.

### Estados

Solo está implementado `registrada`, que es el estado inicial. Ningún endpoint permite
cambiarlo. Propuesta de estados futuros, **no implementada**, a validar:

`registrada` → `asignada` → `en_atencion` → `resuelta` → `cerrada` (tras la revisión
del solicitante), más `anulada` y `reabierta`.

Cada transición se registrará como un `IncidentEvent`.

### Trazabilidad

- `IncidentEvent` es un registro de solo adición: tipo, autor, estado anterior y nuevo, y
  detalles en JSON.
- Hoy se registra el evento `created`. Los cambios futuros añadirán nuevos tipos.

### Entidades futuras, separadas de `Incident`

`Assignment` (asignación), `Intervention` (intervención técnica), `Review` (revisión) y
`SatisfactionSurvey` (satisfacción) serán modelos propios con clave foránea a
`Incident`. No se agregaron campos de esas etapas al modelo actual.

### Permisos (aplicados en el servidor)

| Acción | Quién |
|---|---|
| Ver opciones y registrar (`POST /incidents/`) | Rol `solicitante`; un usuario con varios roles que incluyan `solicitante` también puede |
| Consultar las propias (`scope=mine`) | Cualquier usuario autenticado (solo ve lo que él registró) |
| Consultar las de un área (`scope=area`) y su detalle | Rol `planificador` con `can_plan`, o rol `personal_atencion` con `can_be_assigned`, en esa área. **Reemplazado por el [ADR 0004](0004-planificacion.md)**: la pertenencia sin función ya no da acceso |
| Rol `administrador` | **Sin acceso global** a incidencias en esta etapa |

- Una incidencia que el usuario no puede ver responde **404**, no 403, para no revelar si existe.
- No hay acceso entre áreas.
- Los integrantes de cada área los gestiona un superusuario desde el admin.

### Evidencias

- **Validación del contenido real**, sin confiar en la extensión ni en el tipo declarado:
  1. Se comprueba el tamaño.
  2. Se identifican los *magic bytes* de la cabecera.
  3. Pillow verifica la imagen y su formato debe coincidir con el detectado.
  4. Se limitan las dimensiones: 10 000 px por lado y 40 MP, como protección contra *decompression bombs*.
- **Eliminación de metadatos:** la imagen validada se vuelve a codificar en el mismo
  formato y **nunca se guarda el archivo original**.
  - Se eliminan EXIF (incluida la ubicación GPS, el equipo y la fecha), XMP, comentarios
    JPEG y bloques de texto PNG.
  - Antes se aplica a los píxeles la orientación EXIF, para que la foto se vea igual.
  - Solo se conserva el perfil de color (ICC) y, en PNG, la transparencia.
  - JPEG y WebP se guardan con calidad 90. El tamaño y las dimensiones registrados son
    los del archivo limpio.
  - En imágenes animadas (PNG o WebP) solo se conserva el primer fotograma.
  - Lo hace `attachments.prepare_evidence_image`. El servicio `create_incident` solo
    acepta su resultado (`EvidenceImage`), así que ninguna ruta guarda un archivo sin limpiar.
- **Almacenamiento:** con un nombre aleatorio (UUID) en `MEDIA_ROOT/incidents/AAAA/MM/`. El
  nombre original se conserva solo para mostrarlo, sin rutas.
- **No se publican en `MEDIA_URL`.** Solo se sirven mediante
  `/api/v1/incidents/<código>/attachments/<id>/`, que comprueba los permisos y envía estas cabeceras:
  - `Content-Type` detectado;
  - `X-Content-Type-Options: nosniff`;
  - `Cache-Control: private, no-store`;
  - `Content-Security-Policy: default-src 'none'; sandbox`.
- Si el registro falla después de guardar el archivo, el archivo se elimina.

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/v1/incidents/options/` | UPS activas y áreas de soporte (solo solicitante) |
| POST | `/api/v1/incidents/` | Registro, en multipart. Responde 201 con el detalle y el código |
| GET | `/api/v1/incidents/?scope=mine\|area&page=N` | Listado paginado, de 20 en 20 |
| GET | `/api/v1/incidents/<código>/` | Detalle. No distingue mayúsculas en el código |
| GET | `/api/v1/incidents/<código>/attachments/<id>/` | Imagen de evidencia protegida |

## Pendiente de validar con Walter

1. ¿Quién puede registrar incidencias? Hoy solo el rol `solicitante`. ¿Deben poder hacerlo
   también el personal de atención o el planificador?
2. ¿Qué ve el rol `administrador`? Hoy no tiene acceso global.
3. ¿Cómo se define la pertenencia a un área de soporte, quién la administra y si un usuario
   puede pertenecer a varias áreas?
4. El catálogo oficial de UPS y servicios: códigos, nombres y jerarquía.
5. Los estados y transiciones del flujo completo, incluidos los de anulación y reapertura.
6. Evidencias:
   - ¿Más de una imagen por incidencia?
   - ¿Video o PDF?
   - Hoy se eliminan **todos** los metadatos (EXIF, GPS, XMP). ¿Hace falta conservar
     alguno, como la fecha de captura? Si se conserva, debe guardarse aparte y no en la imagen.
   - ¿Plazo de conservación?
7. Formato y reinicio anual del código de incidencia.
8. Descripciones orientativas de cada área en el formulario
   (`frontend/src/features/incidents/supportAreas.ts`).
9. Integración futura con el inventario institucional y la lectura QR del activo.
10. Notificaciones al área de soporte cuando se registra una incidencia.
