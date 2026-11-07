"""
Identificación del equipo mediante QR (ADR 0005).

Reglas compartidas por el serializer de registro y el servicio ``create_incident``;
PostgreSQL vuelve a exigir la coherencia con restricciones CHECK.

- La pregunta "¿El equipo tiene código QR?" es obligatoria y tiene cuatro respuestas.
- Solo con un QR legible se exige su contenido; en los demás casos no se guarda código.
- Sin un QR utilizable (QR ilegible, sin QR o no es un equipo) es **obligatorio
  adjuntar una fotografía** de la incidencia.
- No se asume ningún formato de QR ni se interpreta su contenido: se conserva el
  texto leído, sin espacios en los extremos, y se rechazan caracteres de control o de
  formato invisibles. Nunca se abre ni se consulta una URL contenida en el QR.
- La forma de captura (``manual`` o ``scan``) es un dato **declarado por el cliente**:
  el servidor solo comprueba que sea un valor conocido y coherente, pero no puede
  verificar que el código se haya leído realmente con la cámara. No tiene valor de
  seguridad ni de auditoría.
- No se asocia el QR con equipos del inventario: esa validación queda pendiente
  hasta integrar el inventario institucional autorizado.
"""

import unicodedata

from django.core.exceptions import ValidationError

QR_CODE_MAX = 255

STATUS_REQUIRED = "Indica si el equipo tiene código QR."
QR_REQUIRED = "Escribe o escanea el contenido del código QR."
QR_NOT_ALLOWED = "No corresponde registrar un código QR con la opción seleccionada."
QR_TOO_LONG = f"El contenido del QR no puede superar {QR_CODE_MAX} caracteres."
QR_INVALID_CHARS = (
    "El contenido del QR tiene caracteres no permitidos (saltos de línea o de control)."
)
METHOD_INVALID = "La forma de captura del QR no es válida."
METHOD_NOT_ALLOWED = "La forma de captura solo corresponde a un QR legible."
PHOTO_REQUIRED = (
    "Adjunta una fotografía de la incidencia: es obligatoria cuando no hay un QR legible."
)


def _has_forbidden_chars(value: str) -> bool:
    # Cc: control (saltos de línea, tabulaciones, NUL…). Cf: formato invisible, como
    # las marcas de dirección que permiten disfrazar un texto al mostrarlo.
    return any(unicodedata.category(char) in {"Cc", "Cf"} for char in value)


def requires_photo(status: str) -> bool:
    """Sin un QR legible, la fotografía es la evidencia mínima de la incidencia."""
    from .models import Incident

    return status != Incident.EquipmentQrStatus.QR_READABLE


def clean_equipment_identification(
    status: str, qr_code: str | None, capture_method: str | None = None
) -> tuple[str, str, str]:
    """
    Valida la combinación y devuelve ``(estado, código, forma de captura)``.

    ``capture_method`` es opcional: si no se indica con un QR legible, se registra
    ``manual``. Lanza ``ValidationError`` con los errores por campo.
    """
    from .models import Incident

    statuses = Incident.EquipmentQrStatus
    methods = Incident.QrCaptureMethod
    qr_code = (qr_code or "").strip()
    capture_method = capture_method or ""

    if status not in statuses.public_values():
        raise ValidationError({"equipment_qr_status": STATUS_REQUIRED})

    if status != statuses.QR_READABLE:
        if qr_code:
            raise ValidationError({"qr_code": QR_NOT_ALLOWED})
        if capture_method:
            raise ValidationError({"qr_capture_method": METHOD_NOT_ALLOWED})
        return status, "", ""

    if capture_method and capture_method not in methods.values:
        raise ValidationError({"qr_capture_method": METHOD_INVALID})
    if not qr_code:
        raise ValidationError({"qr_code": QR_REQUIRED})
    if len(qr_code) > QR_CODE_MAX:
        raise ValidationError({"qr_code": QR_TOO_LONG})
    if _has_forbidden_chars(qr_code):
        raise ValidationError({"qr_code": QR_INVALID_CHARS})
    return status, qr_code, capture_method or methods.MANUAL
