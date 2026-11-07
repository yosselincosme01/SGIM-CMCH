import io

import pytest
from django.urls import reverse
from PIL import Image
from rest_framework import status

from apps.accounts.roles import Role
from apps.catalogs.models import CareUnit
from apps.incidents.models import Incident
from apps.incidents.services import create_incident

from .conftest import FAKE_DEVICE, image_bytes, photo_with_metadata, upload

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/incidents/"
OPTIONS_URL = "/api/v1/incidents/options/"


def detail_url(code: str) -> str:
    return f"/api/v1/incidents/{code}/"


def _incident(user, care_unit, area, text="Incidencia ficticia de prueba"):
    return create_incident(user=user, care_unit=care_unit, support_area=area, description=text)


# --- Rutas y opciones --------------------------------------------------------


def test_routes_are_versioned():
    assert reverse("v1:incidents:list") == LIST_URL
    assert reverse("v1:incidents:options") == OPTIONS_URL
    assert reverse("v1:incidents:detail", kwargs={"code": "INC-2026-000001"}) == (
        "/api/v1/incidents/INC-2026-000001/"
    )


def test_options_list_active_units_and_support_areas(client_for, solicitante, care_unit):
    CareUnit.objects.create(code="demo-inactiva", name="[DEMO] Inactiva", is_active=False)

    body = client_for(solicitante).get(OPTIONS_URL).json()

    assert body["care_units"] == [
        {"code": "demo-emergencia", "name": "[DEMO] Emergencia", "is_demo": True}
    ]
    assert [area["name"] for area in body["support_areas"]] == [
        "Ingeniería Clínica",
        "Mantenimiento",
        "TI",
    ]


def test_options_require_solicitante_role(client_for, make_user):
    planner = make_user("plan.prueba", Role.PLANIFICADOR)

    assert client_for(planner).get(OPTIONS_URL).status_code == status.HTTP_403_FORBIDDEN


# --- Registro --------------------------------------------------------------


def test_create_incident_with_photo(client_for, solicitante, valid_payload):
    payload = {**valid_payload, "photo": upload("evidencia.jpg", image_bytes("JPEG"), "image/jpeg")}

    response = client_for(solicitante).post(LIST_URL, payload, format="multipart")

    assert response.status_code == status.HTTP_201_CREATED
    body = response.json()
    assert body["code"].startswith("INC-")
    assert body["status"] == "registrada"
    assert body["created_by"] == {"username": "ana.prueba", "full_name": "Ana Prueba"}
    assert body["care_unit"]["code"] == "demo-emergencia"
    assert body["support_area"]["code"] == "ti"
    assert len(body["attachments"]) == 1
    assert body["attachments"][0]["content_type"] == "image/jpeg"
    assert body["events"][0]["event_type"] == "created"


def test_create_incident_without_optional_fields(client_for, solicitante, care_unit, area_ti):
    payload = {
        "care_unit": care_unit.code,
        "support_area": area_ti.code,
        "description": "Descripción mínima válida.",
    }

    response = client_for(solicitante).post(LIST_URL, payload, format="multipart")

    assert response.status_code == status.HTTP_201_CREATED
    assert response.json()["attachments"] == []


def test_author_is_always_the_authenticated_user(
    client_for, solicitante, otro_solicitante, valid_payload
):
    response = client_for(solicitante).post(
        LIST_URL, {**valid_payload, "created_by": otro_solicitante.pk}, format="multipart"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "created_by" in response.json()
    assert Incident.objects.count() == 0


@pytest.mark.parametrize("field", ["status", "code", "created_at"])
def test_system_fields_cannot_be_set_from_the_form(client_for, solicitante, valid_payload, field):
    response = client_for(solicitante).post(
        LIST_URL, {**valid_payload, field: "cerrada"}, format="multipart"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()[field] == ["Este campo no está permitido."]


@pytest.mark.parametrize(
    ("changes", "field", "message"),
    [
        ({"care_unit": ""}, "care_unit", "UPS"),
        ({"care_unit": "no-existe"}, "care_unit", "no es válido"),
        ({"support_area": "otra-area"}, "support_area", "no es válida"),
        ({"description": ""}, "description", "Describe el problema"),
        ({"description": "corta"}, "description", "al menos 10"),
        ({"description": "x" * 2001}, "description", "2000"),
        ({"prior_actions": "x" * 1001}, "prior_actions", "1000"),
        ({"asset_reference": "x" * 101}, "asset_reference", "100"),
    ],
)
def test_field_validation(client_for, solicitante, valid_payload, changes, field, message):
    response = client_for(solicitante).post(
        LIST_URL, {**valid_payload, **changes}, format="multipart"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert message in " ".join(response.json()[field])


def test_inactive_care_unit_is_rejected(client_for, solicitante, valid_payload, care_unit):
    care_unit.is_active = False
    care_unit.save()

    response = client_for(solicitante).post(LIST_URL, valid_payload, format="multipart")

    assert response.status_code == status.HTTP_400_BAD_REQUEST


def test_invalid_attachment_is_rejected_and_nothing_is_created(
    client_for, solicitante, valid_payload
):
    fake = upload("foto.jpg", b"no soy una imagen", "image/jpeg")

    response = client_for(solicitante).post(
        LIST_URL, {**valid_payload, "photo": fake}, format="multipart"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "imagen válida" in response.json()["photo"][0]
    assert Incident.objects.count() == 0


def test_oversized_attachment_is_rejected(client_for, solicitante, valid_payload, settings):
    settings.INCIDENT_ATTACHMENT_MAX_BYTES = 50
    photo = upload("foto.png", image_bytes("PNG", (100, 100)))

    response = client_for(solicitante).post(
        LIST_URL, {**valid_payload, "photo": photo}, format="multipart"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "tamaño máximo" in response.json()["photo"][0]


def test_only_solicitante_can_create(client_for, make_user, valid_payload):
    planner = make_user("plan.prueba", Role.PLANIFICADOR, Role.PERSONAL_ATENCION)

    response = client_for(planner).post(LIST_URL, valid_payload, format="multipart")

    assert response.status_code == status.HTTP_403_FORBIDDEN


def test_user_with_several_roles_including_solicitante_can_create(
    client_for, make_user, valid_payload
):
    user = make_user("multi.prueba", Role.PLANIFICADOR, Role.SOLICITANTE)

    response = client_for(user).post(LIST_URL, valid_payload, format="multipart")

    assert response.status_code == status.HTTP_201_CREATED


def test_anonymous_cannot_create_or_list(client_for, valid_payload):
    client = client_for(None)

    assert client.post(LIST_URL, valid_payload, format="multipart").status_code == 401
    assert client.get(LIST_URL).status_code == 401


def test_create_requires_csrf(client_for, solicitante, valid_payload):
    response = client_for(solicitante, enforce_csrf=True).post(
        LIST_URL, valid_payload, format="multipart"
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert Incident.objects.count() == 0


# --- Consulta: solo lo que corresponde ---------------------------------------


def test_solicitante_lists_only_own_incidents(
    client_for, solicitante, otro_solicitante, care_unit, area_ti
):
    own = _incident(solicitante, care_unit, area_ti)
    _incident(otro_solicitante, care_unit, area_ti)

    body = client_for(solicitante).get(LIST_URL).json()

    assert body["count"] == 1
    assert [item["code"] for item in body["results"]] == [own.code]


def test_solicitante_cannot_view_other_users_incident(
    client_for, solicitante, otro_solicitante, care_unit, area_ti
):
    other = _incident(otro_solicitante, care_unit, area_ti)

    response = client_for(solicitante).get(detail_url(other.code))

    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_owner_views_detail_with_lowercase_code(client_for, solicitante, care_unit, area_ti):
    incident = _incident(solicitante, care_unit, area_ti)

    response = client_for(solicitante).get(detail_url(incident.code.lower()))

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["code"] == incident.code
    assert "email" not in response.json()["created_by"]


def test_list_is_paginated_and_newest_first(client_for, solicitante, care_unit, area_ti):
    codes = [_incident(solicitante, care_unit, area_ti).code for _ in range(3)]

    body = client_for(solicitante).get(LIST_URL).json()

    assert [item["code"] for item in body["results"]] == list(reversed(codes))
    assert {"count", "next", "previous", "results"} <= set(body)


def test_solicitante_cannot_use_area_scope(client_for, solicitante):
    assert client_for(solicitante).get(f"{LIST_URL}?scope=area").status_code == 403


def test_unknown_scope_is_rejected(client_for, solicitante):
    assert client_for(solicitante).get(f"{LIST_URL}?scope=todas").status_code == 403


# --- Bandeja del área de soporte ------------------------------------------


def test_area_member_sees_area_incidents_regardless_of_author(
    client_for, make_user, solicitante, otro_solicitante, care_unit, area_ti, area_mantenimiento
):
    planner = make_user("plan.prueba", Role.PLANIFICADOR, plans=("ti",))
    ti_1 = _incident(solicitante, care_unit, area_ti)
    ti_2 = _incident(otro_solicitante, care_unit, area_ti)
    _incident(solicitante, care_unit, area_mantenimiento)

    body = client_for(planner).get(f"{LIST_URL}?scope=area").json()

    assert {item["code"] for item in body["results"]} == {ti_1.code, ti_2.code}


def test_area_member_can_view_detail_but_not_other_areas(
    client_for, make_user, solicitante, care_unit, area_ti, area_mantenimiento
):
    staff = make_user("tec.prueba", Role.PERSONAL_ATENCION, assigned=("ti",))
    ti = _incident(solicitante, care_unit, area_ti)
    other_area = _incident(solicitante, care_unit, area_mantenimiento)
    client = client_for(staff)

    assert client.get(detail_url(ti.code)).status_code == 200
    assert client.get(detail_url(other_area.code)).status_code == 404


@pytest.mark.parametrize("role", [Role.PLANIFICADOR, Role.PERSONAL_ATENCION])
def test_old_rule_role_plus_plain_membership_no_longer_grants_access(
    client_for, make_user, solicitante, care_unit, area_ti, role
):
    """
    Regla anterior: rol global + pertenencia al área. Ahora no basta: sin la función
    explícita en el área (can_plan / can_be_assigned) no hay acceso por ninguna ruta.
    """
    user = make_user("antiguo.prueba", role, areas=("ti",))
    incident = _incident(solicitante, care_unit, area_ti)
    client = client_for(user)

    assert client.get(f"{LIST_URL}?scope=area").status_code == 403
    assert client.get(detail_url(incident.code)).status_code == 404
    assert client.get(f"{detail_url(incident.code)}technicians/").status_code in (403, 404)


def test_function_without_global_role_grants_nothing(
    client_for, make_user, solicitante, care_unit, area_ti
):
    """La función en el área sin el rol global correspondiente no da acceso."""
    user = make_user("sin.rol", Role.SOLICITANTE, plans=("ti",), assigned=("ti",))
    incident = _incident(solicitante, care_unit, area_ti)

    assert client_for(user).get(f"{LIST_URL}?scope=area").status_code == 403
    assert client_for(user).get(detail_url(incident.code)).status_code == 404


def test_superuser_without_area_function_has_no_access(
    client_for, make_user, solicitante, care_unit, area_ti
):
    root = make_user("soporte.prueba", is_superuser=True)
    incident = _incident(solicitante, care_unit, area_ti)
    client = client_for(root)

    assert client.get(f"{LIST_URL}?scope=area").status_code == 403
    assert client.get(detail_url(incident.code)).status_code == 404
    assert client.get(OPTIONS_URL).status_code == 403
    assert client.get("/api/v1/incidents/planning/").status_code == 403


def test_planner_without_membership_sees_no_area_incidents(
    client_for, make_user, solicitante, care_unit, area_ti
):
    planner = make_user("plan.prueba", Role.PLANIFICADOR)
    incident = _incident(solicitante, care_unit, area_ti)

    assert client_for(planner).get(f"{LIST_URL}?scope=area").status_code == 403
    assert client_for(planner).get(detail_url(incident.code)).status_code == 404


def test_membership_without_area_role_grants_nothing(
    client_for, make_user, solicitante, care_unit, area_ti
):
    """Pertenecer a un área sin rol planificador/personal_atencion no da acceso."""
    user = make_user("solo.miembro", Role.SOLICITANTE, areas=("ti",))
    incident = _incident(solicitante, care_unit, area_ti)

    assert client_for(user).get(detail_url(incident.code)).status_code == 404


def test_administrator_role_has_no_global_access(
    client_for, make_user, solicitante, care_unit, area_ti
):
    admin = make_user("admin.prueba", Role.ADMINISTRADOR)
    incident = _incident(solicitante, care_unit, area_ti)

    assert client_for(admin).get(detail_url(incident.code)).status_code == 404
    assert client_for(admin).get(LIST_URL).json()["count"] == 0


# --- Evidencias ----------------------------------------------------------------


def _incident_with_photo(client_for, user, payload):
    photo = upload("evidencia.png", image_bytes("PNG"))
    body = client_for(user).post(LIST_URL, {**payload, "photo": photo}, format="multipart").json()
    return body["code"], body["attachments"][0]["url"]


def test_owner_downloads_attachment_with_safe_headers(client_for, solicitante, valid_payload):
    _, url = _incident_with_photo(client_for, solicitante, valid_payload)

    response = client_for(solicitante).get(url)

    assert response.status_code == 200
    assert response["Content-Type"] == "image/png"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Cache-Control"] == "private, no-store"
    assert "sandbox" in response["Content-Security-Policy"]
    assert b"".join(response.streaming_content).startswith(b"\x89PNG")


def test_stored_photo_has_no_gps_or_exif(client_for, solicitante, valid_payload):
    """La foto que se guarda y se descarga no conserva la ubicación ni el equipo."""
    photo = upload("evidencia.jpg", photo_with_metadata("JPEG", orientation=6), "image/jpeg")
    client = client_for(solicitante)
    body = client.post(LIST_URL, {**valid_payload, "photo": photo}, format="multipart").json()

    response = client.get(body["attachments"][0]["url"])
    content = b"".join(response.streaming_content)

    assert response["Content-Type"] == "image/jpeg"
    assert FAKE_DEVICE.encode() not in content
    with Image.open(io.BytesIO(content)) as image:
        assert len(image.getexif()) == 0
        assert image.size == (30, 40)  # orientación aplicada a los píxeles


def test_other_user_cannot_download_attachment(
    client_for, solicitante, otro_solicitante, valid_payload
):
    _, url = _incident_with_photo(client_for, solicitante, valid_payload)

    assert client_for(otro_solicitante).get(url).status_code == 404
    assert client_for(None).get(url).status_code == 401


def test_attachment_id_must_belong_to_the_incident(
    client_for, solicitante, valid_payload, care_unit, area_ti
):
    _, url = _incident_with_photo(client_for, solicitante, valid_payload)
    other = _incident(solicitante, care_unit, area_ti)
    attachment_id = url.rstrip("/").rsplit("/", 1)[-1]

    response = client_for(solicitante).get(f"{detail_url(other.code)}attachments/{attachment_id}/")

    assert response.status_code == 404
