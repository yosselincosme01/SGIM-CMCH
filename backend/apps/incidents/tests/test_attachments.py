"""Validación y limpieza de imágenes de evidencia. No usa base de datos."""

import io

import pytest
from django.core.exceptions import ValidationError
from PIL import Image

from apps.incidents import attachments
from apps.incidents.attachments import (
    prepare_evidence_image,
    safe_original_name,
    validate_evidence_image,
)

from .conftest import FAKE_DEVICE, FAKE_XMP, image_bytes, photo_with_metadata, upload

FORMATS = [
    ("JPEG", "image/jpeg", "jpg"),
    ("PNG", "image/png", "png"),
    ("WEBP", "image/webp", "webp"),
]
GPS_IFD = 0x8825


@pytest.mark.parametrize(
    ("fmt", "content_type", "extension"),
    [("PNG", "image/png", "png"), ("JPEG", "image/jpeg", "jpg"), ("WEBP", "image/webp", "webp")],
)
def test_accepts_valid_images(fmt, content_type, extension):
    info = validate_evidence_image(upload(f"foto.{extension}", image_bytes(fmt, (40, 30))))

    assert info.content_type == content_type
    assert info.extension == extension
    assert (info.width, info.height) == (40, 30)


def test_type_comes_from_content_not_from_extension_or_declared_type():
    """Un JPEG con nombre .png y tipo declarado image/png se registra como JPEG."""
    info = validate_evidence_image(upload("foto.png", image_bytes("JPEG"), "image/png"))

    assert info.content_type == "image/jpeg"
    assert info.extension == "jpg"


@pytest.mark.parametrize(
    ("name", "content", "content_type"),
    [
        ("foto.jpg", b"esto no es una imagen", "image/jpeg"),  # texto con extensión .jpg
        ("script.png", b"<script>alert(1)</script>", "image/png"),
        ("doc.pdf", b"%PDF-1.7 documento", "application/pdf"),
        ("anim.gif", image_bytes("GIF"), "image/gif"),  # formato no permitido
        ("foto.png", image_bytes("PNG")[:40], "image/png"),  # PNG truncado
        ("falso.png", b"\x89PNG\r\n\x1a\n" + image_bytes("JPEG"), "image/png"),  # cabecera falsa
    ],
)
def test_rejects_non_images_and_disallowed_formats(name, content, content_type):
    with pytest.raises(ValidationError):
        validate_evidence_image(upload(name, content, content_type))


def test_rejects_empty_file():
    with pytest.raises(ValidationError, match="vacío"):
        validate_evidence_image(upload("vacio.png", b""))


def test_rejects_files_over_the_size_limit(settings):
    settings.INCIDENT_ATTACHMENT_MAX_BYTES = 100

    with pytest.raises(ValidationError, match="tamaño máximo"):
        validate_evidence_image(upload("grande.png", image_bytes("PNG", (200, 200))))


def test_rejects_excessive_dimensions(monkeypatch):
    monkeypatch.setattr(attachments, "MAX_PIXELS", 100)

    with pytest.raises(ValidationError, match="dimensiones"):
        validate_evidence_image(upload("enorme.png", image_bytes("PNG", (20, 20))))


def test_file_pointer_is_rewound_after_validation():
    photo = upload("foto.png", image_bytes("PNG"))
    validate_evidence_image(photo)

    assert photo.tell() == 0


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("foto.jpg", "foto.jpg"),
        ("C:\\Users\\x\\foto.jpg", "foto.jpg"),
        ("../../etc/passwd", "passwd"),
        ('a<b>"c".png', "abc.png"),
        ("", "imagen"),
    ],
)
def test_safe_original_name(name, expected):
    assert safe_original_name(name) == expected


# --- Eliminación de metadatos --------------------------------------------------


def _open(content: bytes) -> Image.Image:
    image = Image.open(io.BytesIO(content))
    image.load()
    return image


@pytest.mark.parametrize(("fmt", "content_type", "extension"), FORMATS)
def test_metadata_is_removed(fmt, content_type, extension):
    original = photo_with_metadata(fmt)
    # Comprobación previa: la foto de prueba sí trae los metadatos.
    assert FAKE_DEVICE.encode() in original
    assert _open(original).getexif().get_ifd(GPS_IFD)

    evidence = prepare_evidence_image(upload(f"foto.{extension}", original, content_type))
    content = evidence.file.read()
    cleaned = _open(content)

    assert cleaned.format == fmt
    assert len(cleaned.getexif()) == 0  # sin EXIF, y por lo tanto sin GPS
    assert not cleaned.getexif().get_ifd(GPS_IFD)
    for key in ("exif", "xmp", "XML:com.adobe.xmp", "comment", "Comment", "Description"):
        assert key not in cleaned.info
    assert FAKE_DEVICE.encode() not in content
    assert FAKE_XMP not in content
    assert b"ubicacion-ficticia-sgim" not in content
    assert evidence.info.content_type == content_type
    assert evidence.info.extension == extension
    assert evidence.info.size == len(content)


@pytest.mark.parametrize(("fmt", "content_type", "extension"), FORMATS)
def test_exif_orientation_is_applied_to_the_pixels(fmt, content_type, extension):
    """Orientación 6 (girar 90° a la derecha): la mitad izquierda, roja, queda arriba."""
    original = photo_with_metadata(fmt, (40, 30), orientation=6)

    evidence = prepare_evidence_image(upload(f"foto.{extension}", original, content_type))
    cleaned = _open(evidence.file.read()).convert("RGB")

    assert cleaned.size == (30, 40)
    assert (evidence.info.width, evidence.info.height) == (30, 40)
    top_r, _, top_b = cleaned.getpixel((15, 5))
    bottom_r, _, bottom_b = cleaned.getpixel((15, 35))
    assert top_r > 200 and top_b < 60
    assert bottom_b > 200 and bottom_r < 60


@pytest.mark.parametrize(("fmt", "content_type", "extension"), FORMATS)
def test_color_profile_is_kept(fmt, content_type, extension):
    original = photo_with_metadata(fmt, icc=True)
    icc = _open(original).info["icc_profile"]

    evidence = prepare_evidence_image(upload(f"foto.{extension}", original, content_type))

    assert _open(evidence.file.read()).info.get("icc_profile") == icc


def test_png_transparency_is_kept():
    buffer = io.BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 0)).save(buffer, format="PNG")

    evidence = prepare_evidence_image(upload("transparente.png", buffer.getvalue()))
    cleaned = _open(evidence.file.read())

    assert cleaned.mode == "RGBA"
    assert cleaned.getpixel((5, 5))[3] == 0


def test_prepared_evidence_keeps_display_name_but_not_original_bytes():
    original = photo_with_metadata("JPEG")
    photo = upload("C:\\fotos\\puerta rota.jpg", original, "image/jpeg")

    evidence = prepare_evidence_image(photo)

    assert evidence.original_name == "puerta rota.jpg"
    assert evidence.file.name == "evidencia.jpg"
    assert evidence.file.read() != original


def test_invalid_images_are_rejected_before_cleaning():
    with pytest.raises(ValidationError):
        prepare_evidence_image(upload("foto.jpg", b"esto no es una imagen", "image/jpeg"))
