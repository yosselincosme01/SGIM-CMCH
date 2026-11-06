"""Fixtures de incidencias. Solo datos ficticios."""

import io

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import ExifTags, Image, ImageCms, PngImagePlugin
from rest_framework.test import APIClient

from apps.accounts.roles import Role
from apps.catalogs.models import CareUnit
from apps.incidents.models import SupportArea, SupportAreaMembership

PASSWORD = "Clave-de-prueba-2026"  # noqa: S105 - contraseña ficticia de pruebas


def image_bytes(fmt: str = "PNG", size: tuple[int, int] = (32, 24)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (154, 19, 49)).save(buffer, format=fmt)
    return buffer.getvalue()


# Marcadores ficticios que no deben sobrevivir a la limpieza de metadatos.
FAKE_GPS_LATITUDE = (12.0, 3.0, 45.5)
FAKE_DEVICE = "Telefono-Ficticio-SGIM"
FAKE_XMP = b'<x:xmpmeta xmlns:x="adobe:ns:meta/">ubicacion-ficticia-sgim</x:xmpmeta>'


def photo_with_metadata(
    fmt: str = "JPEG", size: tuple[int, int] = (40, 30), *, orientation: int = 1, icc: bool = False
) -> bytes:
    """
    Foto ficticia con EXIF (GPS, equipo y orientación), XMP y comentario o texto PNG.
    La mitad izquierda es roja y la derecha, azul, para comprobar la orientación.
    """
    width, height = size
    image = Image.new("RGB", size, (0, 0, 255))
    image.paste((255, 0, 0), (0, 0, width // 2, height))

    exif = Image.Exif()
    exif[ExifTags.Base.Make] = FAKE_DEVICE
    exif[ExifTags.Base.Orientation] = orientation
    gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
    gps[ExifTags.GPS.GPSLatitudeRef] = "S"
    gps[ExifTags.GPS.GPSLatitude] = FAKE_GPS_LATITUDE

    options: dict = {"exif": exif.tobytes(), "xmp": FAKE_XMP}
    if icc:
        options["icc_profile"] = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    if fmt == "JPEG":
        options["comment"] = f"Tomada con {FAKE_DEVICE}"
    if fmt == "PNG":
        text = PngImagePlugin.PngInfo()
        text.add_text("Comment", f"Tomada con {FAKE_DEVICE}")
        text.add_itxt("Description", "ubicacion-ficticia-sgim")
        options["pnginfo"] = text

    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **options)
    return buffer.getvalue()


def upload(name: str, content: bytes, content_type: str = "image/png") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, content, content_type=content_type)


@pytest.fixture(autouse=True)
def _media_root(settings, tmp_path):
    """Los archivos de prueba se guardan en un directorio temporal, nunca en backend/media."""
    settings.MEDIA_ROOT = tmp_path / "media"


@pytest.fixture
def make_user(db):
    def _make_user(username: str, *roles: Role, areas: tuple[str, ...] = ()):
        user = get_user_model().objects.create_user(
            username=username,
            password=PASSWORD,
            email=f"{username}@example.test",
            first_name=username.split(".")[0].title(),
            last_name="Prueba",
        )
        user.groups.add(*Group.objects.filter(name__in=roles))
        for code in areas:
            SupportAreaMembership.objects.create(area=SupportArea.objects.get(code=code), user=user)
        return user

    return _make_user


@pytest.fixture
def solicitante(make_user):
    return make_user("ana.prueba", Role.SOLICITANTE)


@pytest.fixture
def otro_solicitante(make_user):
    return make_user("otro.prueba", Role.SOLICITANTE)


@pytest.fixture
def care_unit(db):
    return CareUnit.objects.create(code="demo-emergencia", name="[DEMO] Emergencia", is_demo=True)


@pytest.fixture
def area_ti(db):
    return SupportArea.objects.get(code="ti")


@pytest.fixture
def area_mantenimiento(db):
    return SupportArea.objects.get(code="mantenimiento")


@pytest.fixture
def client_for():
    def _client_for(user, *, enforce_csrf: bool = False) -> APIClient:
        client = APIClient(enforce_csrf_checks=enforce_csrf)
        if user is not None:
            client.force_login(user)
        return client

    return _client_for


@pytest.fixture
def valid_payload(care_unit, area_ti):
    return {
        "care_unit": care_unit.code,
        "support_area": area_ti.code,
        "description": "La impresora del módulo de admisión no imprime etiquetas.",
        "prior_actions": "Se reinició la impresora.",
        "asset_reference": "DEMO-IMP-001",
    }
