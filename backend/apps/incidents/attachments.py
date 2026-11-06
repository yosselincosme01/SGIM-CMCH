"""
Validación de imágenes de evidencia.

No se confía en la extensión ni en el Content-Type enviados por el cliente:
1. se comprueba el tamaño;
2. se identifican los "magic bytes" de la cabecera (JPEG, PNG o WebP);
3. Pillow verifica que el archivo sea una imagen válida del MISMO formato;
4. se limitan las dimensiones (protección contra "decompression bombs").

El tipo de contenido y la extensión que se guardan son los detectados aquí.

Después, ``prepare_evidence_image`` vuelve a codificar la imagen **sin metadatos**
(EXIF, GPS, XMP, comentarios y bloques de texto PNG). Antes aplica la orientación
EXIF a los píxeles, para que la foto se vea igual sin ese dato. Solo se conserva el
perfil de color (ICC). Nunca se guarda el archivo original.
"""

import io
from dataclasses import dataclass, replace

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

MAX_DIMENSION = 10_000
MAX_PIXELS = 40_000_000

# formato Pillow -> (tipo de contenido, extensión)
ALLOWED_FORMATS = {
    "JPEG": ("image/jpeg", "jpg"),
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
}

INVALID_IMAGE = "El archivo no es una imagen válida. Usa una fotografía JPG, PNG o WebP."


@dataclass(frozen=True)
class ImageInfo:
    content_type: str
    extension: str
    width: int
    height: int
    size: int


def max_attachment_bytes() -> int:
    return settings.INCIDENT_ATTACHMENT_MAX_BYTES


def _format_from_magic_bytes(header: bytes) -> str | None:
    if header.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if header[:4] == b"RIFF" and header[8:12] == b"WEBP":
        return "WEBP"
    return None


def validate_evidence_image(uploaded_file) -> ImageInfo:
    size = uploaded_file.size or 0
    limit = max_attachment_bytes()
    if size == 0:
        raise ValidationError("El archivo está vacío.", code="empty")
    if size > limit:
        raise ValidationError(
            f"La imagen supera el tamaño máximo de {limit // (1024 * 1024)} MB.", code="too_large"
        )

    uploaded_file.seek(0)
    header = uploaded_file.read(16)
    magic_format = _format_from_magic_bytes(header)
    if magic_format is None:
        raise ValidationError(INVALID_IMAGE, code="invalid_type")

    try:
        uploaded_file.seek(0)
        with Image.open(uploaded_file) as image:
            image_format = image.format
            width, height = image.size
            image.verify()  # detecta archivos truncados o corruptos
    except (
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
        Image.DecompressionBombError,
    ) as exc:
        raise ValidationError(INVALID_IMAGE, code="invalid_image") from exc
    finally:
        uploaded_file.seek(0)

    if image_format != magic_format or image_format not in ALLOWED_FORMATS:
        raise ValidationError(INVALID_IMAGE, code="format_mismatch")
    if width > MAX_DIMENSION or height > MAX_DIMENSION or width * height > MAX_PIXELS:
        raise ValidationError("Las dimensiones de la imagen son demasiado grandes.", code="too_big")

    content_type, extension = ALLOWED_FORMATS[image_format]
    return ImageInfo(content_type, extension, width, height, size)


@dataclass(frozen=True)
class EvidenceImage:
    """Imagen validada y sin metadatos, lista para guardarse (ver ``prepare_evidence_image``)."""

    file: ContentFile
    original_name: str
    info: ImageInfo


FORMAT_BY_EXTENSION = {extension: fmt for fmt, (_, extension) in ALLOWED_FORMATS.items()}

# Opciones de codificación por formato. La calidad 90 conserva el detalle de una evidencia.
_ENCODER_OPTIONS = {
    "JPEG": {"quality": 90, "optimize": True},
    "PNG": {"optimize": True},
    "WEBP": {"quality": 90},
}
_COMPATIBLE_MODES = {
    "JPEG": {"RGB", "L", "CMYK"},
    "WEBP": {"RGB", "RGBA"},
}


def _without_metadata(uploaded_file, image_format: str) -> tuple[bytes, int, int]:
    """Decodifica la imagen y la vuelve a codificar con solo sus píxeles y su perfil ICC."""
    uploaded_file.seek(0)
    try:
        with Image.open(uploaded_file) as source:
            source.load()
            # Aplica la orientación EXIF a los píxeles y devuelve una copia independiente.
            image = ImageOps.exif_transpose(source)
            icc_profile = source.info.get("icc_profile")
            transparency = source.info.get("transparency")
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ValidationError(INVALID_IMAGE, code="invalid_image") from exc
    finally:
        uploaded_file.seek(0)

    compatible = _COMPATIBLE_MODES.get(image_format)
    if compatible and image.mode not in compatible:
        has_alpha = "A" in image.mode or transparency is not None
        image = image.convert("RGBA" if has_alpha and "RGBA" in compatible else "RGB")
        transparency = None

    # Algunos codificadores leen datos de image.info (por ejemplo, el comentario JPEG):
    # se vacía y solo se pasan, de forma explícita, los datos que se conservan.
    image.info = {}
    options = dict(_ENCODER_OPTIONS[image_format])
    if icc_profile:
        options["icc_profile"] = icc_profile
    if image_format == "PNG" and transparency is not None:
        options["transparency"] = transparency

    output = io.BytesIO()
    image.save(output, format=image_format, **options)
    return output.getvalue(), image.width, image.height


def prepare_evidence_image(uploaded_file) -> EvidenceImage:
    """
    Valida la imagen y devuelve una copia sin metadatos, en el mismo formato.

    En imágenes animadas (PNG o WebP) solo se conserva el primer fotograma.
    """
    info = validate_evidence_image(uploaded_file)
    image_format = FORMAT_BY_EXTENSION[info.extension]
    content, width, height = _without_metadata(uploaded_file, image_format)
    clean_info = replace(info, width=width, height=height, size=len(content))
    return EvidenceImage(
        file=ContentFile(content, name=f"evidencia.{info.extension}"),
        original_name=safe_original_name(uploaded_file.name),
        info=clean_info,
    )


def safe_original_name(name: str) -> str:
    """Nombre original solo para mostrar: sin rutas ni caracteres de control."""
    base = (name or "imagen").replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(ch for ch in base if ch.isprintable() and ch not in '<>:"|?*')
    return (cleaned.strip() or "imagen")[:150]
