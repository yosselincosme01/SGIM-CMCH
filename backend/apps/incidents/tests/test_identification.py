"""
Identificación del equipo mediante QR (ADR 0005): cuatro opciones, validaciones en la
API, el servicio y PostgreSQL, campo legado y protección de datos. Datos ficticios.
"""

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from rest_framework import status

from apps.accounts.roles import Role
from apps.incidents.attachments import prepare_evidence_image
from apps.incidents.identification import PHOTO_REQUIRED, QR_CODE_MAX, QR_REQUIRED
from apps.incidents.models import Incident
from apps.incidents.services import create_incident

from .conftest import image_bytes, upload

pytestmark = pytest.mark.django_db

LIST_URL = "/api/v1/incidents/"


def detail(code):
    return f"{LIST_URL}{code}/"


def _post(client, payload):
    return client.post(LIST_URL, payload, format="multipart")


def _photo():
    return upload("evidencia.png", image_bytes("PNG"))


@pytest.fixture
def base(care_unit, area_ti):
    return {
        "care_unit": care_unit.code,
        "support_area": area_ti.code,
        "description": "La bomba de infusión muestra un error al encender.",
    }


# --- Las cuatro opciones --------------------------------------------------------


@pytest.mark.parametrize(
    ("option", "extra", "label"),
    [
        ("qr_readable", {"qr_code": "QR-FICTICIO-0001"}, "Tiene QR y puedo leerlo"),
        ("qr_unreadable", {}, "Tiene QR, pero no puedo leerlo"),
        ("no_qr", {}, "El equipo no tiene QR"),
        ("not_equipment", {}, "No corresponde a un equipo"),
    ],
)
def test_each_option_registers_an_incident(client_for, solicitante, base, option, extra, label):
    if option != "qr_readable":
        extra = {**extra, "photo": _photo()}  # sin QR legible, la foto es obligatoria
    response = _post(client_for(solicitante), {**base, "equipment_qr_status": option, **extra})

    assert response.status_code == status.HTTP_201_CREATED, response.json()
    body = response.json()
    assert body["equipment_qr_status"] == option
    assert body["equipment_qr_status_label"] == label
    assert body["qr_code"] == (extra.get("qr_code", "") if option == "qr_readable" else "")
    incident = Incident.objects.get(code=body["code"])
    expected_method = "manual" if option == "qr_readable" else ""
    assert incident.qr_capture_method == expected_method
    assert incident.asset_reference == ""  # el campo legado no se usa en registros nuevos


def test_readable_qr_is_stored_as_read_without_surrounding_spaces(client_for, solicitante, base):
    response = _post(
        client_for(solicitante),
        {**base, "equipment_qr_status": "qr_readable", "qr_code": "  abc/DEF-123 ñ  "},
    )

    assert response.json()["qr_code"] == "abc/DEF-123 ñ"  # sin cambiar mayúsculas ni contenido


def test_qr_with_url_is_kept_as_plain_text(client_for, solicitante, base):
    """No se interpreta ni se consulta: se guarda y se devuelve como texto."""
    url = "https://ejemplo.test/equipo?id=FICTICIO&x=<b>1</b>"
    response = _post(
        client_for(solicitante), {**base, "equipment_qr_status": "qr_readable", "qr_code": url}
    )

    assert response.status_code == 201
    assert response.json()["qr_code"] == url
    assert Incident.objects.get().qr_code == url


def test_qr_at_maximum_length_is_accepted(client_for, solicitante, base):
    code = "Q" * QR_CODE_MAX
    response = _post(
        client_for(solicitante), {**base, "equipment_qr_status": "qr_readable", "qr_code": code}
    )

    assert response.status_code == 201


# --- Validaciones de la API ----------------------------------------------------


@pytest.mark.parametrize("value", [None, "", "unspecified", "otra", "QR_READABLE"])
def test_identification_is_required_and_must_be_a_public_option(
    client_for, solicitante, base, value
):
    payload = dict(base)
    if value is not None:
        payload["equipment_qr_status"] = value

    response = _post(client_for(solicitante), payload)

    assert response.status_code == 400
    assert "equipment_qr_status" in response.json()
    assert not Incident.objects.exists()


@pytest.mark.parametrize("code", [None, "", "   "])
def test_readable_qr_requires_its_content(client_for, solicitante, base, code):
    payload = {**base, "equipment_qr_status": "qr_readable"}
    if code is not None:
        payload["qr_code"] = code

    response = _post(client_for(solicitante), payload)

    assert response.status_code == 400
    assert response.json()["qr_code"] == [QR_REQUIRED]


@pytest.mark.parametrize(
    "code",
    [
        "Q" * (QR_CODE_MAX + 1),
        "QR-1\nQR-2",
        "QR\t1",
        "QR\x001",
        "QR‮1",  # marca de dirección: permitiría disfrazar el texto mostrado
        "QR​1",  # espacio de ancho cero
    ],
)
def test_invalid_qr_content_is_rejected(client_for, solicitante, base, code):
    response = _post(
        client_for(solicitante), {**base, "equipment_qr_status": "qr_readable", "qr_code": code}
    )

    assert response.status_code == 400
    assert "qr_code" in response.json()
    assert not Incident.objects.exists()


@pytest.mark.parametrize("option", ["qr_unreadable", "no_qr", "not_equipment"])
def test_qr_content_is_rejected_for_options_without_readable_qr(
    client_for, solicitante, base, option
):
    response = _post(
        client_for(solicitante), {**base, "equipment_qr_status": option, "qr_code": "QR-1"}
    )

    assert response.status_code == 400
    assert "qr_code" in response.json()
    assert not Incident.objects.exists()


@pytest.mark.parametrize("field", ["asset_reference", "equipment_qr_status_label", "priority"])
def test_unauthorized_fields_are_rejected(client_for, solicitante, base, field):
    payload = {**base, "equipment_qr_status": "qr_readable", "qr_code": "QR-1", field: "scan"}

    response = _post(client_for(solicitante), payload)

    assert response.status_code == 400
    assert response.json()[field] == ["Este campo no está permitido."]
    assert not Incident.objects.exists()


def test_responses_do_not_expose_the_legacy_field(client_for, solicitante, base):
    body = _post(
        client_for(solicitante), {**base, "equipment_qr_status": "no_qr", "photo": _photo()}
    ).json()
    detail_body = client_for(solicitante).get(detail(body["code"])).json()

    for payload in (body, detail_body):
        assert "asset_reference" not in payload


# --- Servicio: las reglas no dependen de la API --------------------------------


@pytest.mark.parametrize(
    ("option", "code"),
    [
        ("qr_readable", ""),
        ("no_qr", "QR-1"),
        ("qr_unreadable", "QR-1"),
        ("not_equipment", "QR-1"),
        ("unspecified", ""),
        ("otra", ""),
    ],
)
def test_service_rejects_incoherent_identification(solicitante, care_unit, area_ti, option, code):
    with pytest.raises(ValidationError):
        create_incident(
            user=solicitante,
            care_unit=care_unit,
            support_area=area_ti,
            description="Descripción ficticia suficientemente larga.",
            equipment_qr_status=option,
            qr_code=code,
        )
    assert not Incident.objects.exists()


# --- Restricciones de la base de datos -----------------------------------------


def _incident(solicitante, care_unit, area_ti, **identification):
    if identification.get("equipment_qr_status") != "qr_readable":
        identification["evidence"] = prepare_evidence_image(_photo())
    return create_incident(
        user=solicitante,
        care_unit=care_unit,
        support_area=area_ti,
        description="Descripción ficticia suficientemente larga.",
        **identification,
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"qr_code": "QR-1"},  # código con una opción sin QR legible
        {"qr_capture_method": "manual"},  # forma de captura sin código
        {"equipment_qr_status": "qr_readable"},  # QR legible sin contenido
        {"equipment_qr_status": "inventada"},  # opción inexistente
    ],
)
def test_database_rejects_incoherent_rows_from_a_not_equipment_incident(
    solicitante, care_unit, area_ti, changes
):
    incident = _incident(solicitante, care_unit, area_ti, equipment_qr_status="not_equipment")

    with pytest.raises(IntegrityError), transaction.atomic():
        Incident.objects.filter(pk=incident.pk).update(**changes)


@pytest.mark.parametrize(
    "changes",
    [
        {"qr_code": ""},
        {"qr_code": " QR-1"},
        {"qr_code": "QR-1 "},
        {"qr_capture_method": ""},
        {"qr_capture_method": "otra"},
        {"equipment_qr_status": "no_qr"},  # cambia la opción pero conserva el código
    ],
)
def test_database_rejects_incoherent_rows_from_a_readable_qr_incident(
    solicitante, care_unit, area_ti, changes
):
    incident = _incident(
        solicitante, care_unit, area_ti, equipment_qr_status="qr_readable", qr_code="QR-1"
    )

    with pytest.raises(IntegrityError), transaction.atomic():
        Incident.objects.filter(pk=incident.pk).update(**changes)


def test_database_accepts_the_future_scan_capture_method(solicitante, care_unit, area_ti):
    """La lectura con cámara está prevista en el modelo, aunque la API no la acepte aún."""
    incident = _incident(
        solicitante, care_unit, area_ti, equipment_qr_status="qr_readable", qr_code="QR-1"
    )

    Incident.objects.filter(pk=incident.pk).update(qr_capture_method="scan")


# --- Protección de datos: se conservan los permisos -----------------------------


def test_qr_is_only_visible_to_who_can_already_see_the_incident(
    client_for, make_user, solicitante, otro_solicitante, base
):
    body = _post(
        client_for(solicitante),
        {**base, "equipment_qr_status": "qr_readable", "qr_code": "QR-PRIVADO-1"},
    ).json()
    planner_ti = make_user("plan.ti", Role.PLANIFICADOR, plans=("ti",))
    planner_mant = make_user("plan.mant", Role.PLANIFICADOR, plans=("mantenimiento",))

    assert client_for(otro_solicitante).get(detail(body["code"])).status_code == 404
    assert client_for(planner_mant).get(detail(body["code"])).status_code == 404
    assert client_for(planner_ti).get(detail(body["code"])).json()["qr_code"] == "QR-PRIVADO-1"
    others = client_for(otro_solicitante).get(LIST_URL).json()
    assert "QR-PRIVADO-1" not in str(others)


def test_lists_do_not_include_the_qr_content(client_for, solicitante, base):
    _post(
        client_for(solicitante),
        {**base, "equipment_qr_status": "qr_readable", "qr_code": "QR-LISTA-1"},
    )

    assert "QR-LISTA-1" not in str(client_for(solicitante).get(LIST_URL).json())


# --- Migración 0005: no elimina datos -------------------------------------------


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_migration_keeps_existing_incidents_and_legacy_values():
    executor = MigrationExecutor(connection)
    executor.migrate([("incidents", "0004_provisional_priority_levels")])
    apps_before = executor.loader.project_state(
        [("incidents", "0004_provisional_priority_levels")]
    ).apps
    user_model = apps_before.get_model("accounts", "User")
    care_unit_model = apps_before.get_model("catalogs", "CareUnit")
    area_model = apps_before.get_model("incidents", "SupportArea")
    incident_model = apps_before.get_model("incidents", "Incident")
    user = user_model.objects.create(username="legado.prueba")
    unit = care_unit_model.objects.create(code="demo-legado", name="[DEMO] Legado", is_demo=True)
    old = incident_model.objects.create(
        care_unit=unit,
        support_area=area_model.objects.get(code="ti"),
        description="Incidencia anterior ficticia",
        asset_reference="DEMO-PATRIMONIO-01",
        created_by=user,
    )

    executor = MigrationExecutor(connection)
    executor.migrate([("incidents", "0005_incident_qr_identification")])
    # Modelo histórico de la 0005: el actual ya incluye columnas de migraciones posteriores.
    after = executor.loader.project_state([("incidents", "0005_incident_qr_identification")]).apps
    migrated = after.get_model("incidents", "Incident").objects.get(pk=old.pk)

    assert migrated.equipment_qr_status == "unspecified"
    assert migrated.qr_code == ""
    assert migrated.qr_capture_method == ""
    assert migrated.asset_reference == "DEMO-PATRIMONIO-01"  # el dato legado se conserva

    executor = MigrationExecutor(connection)
    executor.migrate([("incidents", "0004_provisional_priority_levels")])  # reversible
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


# --- Fotografía obligatoria sin QR legible --------------------------------------


@pytest.mark.parametrize("option", ["qr_unreadable", "no_qr", "not_equipment"])
def test_photo_is_required_without_a_readable_qr(client_for, solicitante, base, option):
    """La API rechaza la solicitud directa sin fotografía (no depende del frontend)."""
    response = _post(client_for(solicitante), {**base, "equipment_qr_status": option})

    assert response.status_code == 400
    assert response.json()["photo"] == [PHOTO_REQUIRED]
    assert not Incident.objects.exists()


def test_photo_stays_optional_with_a_readable_qr(client_for, solicitante, base):
    response = _post(
        client_for(solicitante), {**base, "equipment_qr_status": "qr_readable", "qr_code": "QR-9"}
    )

    assert response.status_code == 201
    assert response.json()["attachments"] == []


def test_required_photo_keeps_the_existing_image_validation(client_for, solicitante, base):
    """La foto obligatoria pasa por el mismo control: tipo real, tamaño y sin metadatos."""
    fake = upload("foto.png", b"esto no es una imagen", "image/png")

    response = _post(
        client_for(solicitante), {**base, "equipment_qr_status": "no_qr", "photo": fake}
    )

    assert response.status_code == 400
    assert "imagen válida" in response.json()["photo"][0]


@pytest.mark.parametrize("option", ["qr_unreadable", "no_qr", "not_equipment"])
def test_service_requires_photo_without_a_readable_qr(solicitante, care_unit, area_ti, option):
    with pytest.raises(ValidationError) as error:
        create_incident(
            user=solicitante,
            care_unit=care_unit,
            support_area=area_ti,
            description="Descripción ficticia suficientemente larga.",
            equipment_qr_status=option,
        )
    assert "photo" in error.value.message_dict
    assert not Incident.objects.exists()


# --- Forma de captura -----------------------------------------------------------


@pytest.mark.parametrize(
    ("sent", "stored"), [(None, "manual"), ("manual", "manual"), ("scan", "scan")]
)
def test_capture_method_is_recorded_for_a_readable_qr(client_for, solicitante, base, sent, stored):
    payload = {**base, "equipment_qr_status": "qr_readable", "qr_code": "QR-CAM-1"}
    if sent is not None:
        payload["qr_capture_method"] = sent

    response = _post(client_for(solicitante), payload)

    assert response.status_code == 201
    assert Incident.objects.get().qr_capture_method == stored


@pytest.mark.parametrize("method", ["camara", "SCAN", "auto", "x" * 11])
def test_unknown_capture_methods_are_rejected(client_for, solicitante, base, method):
    payload = {
        **base,
        "equipment_qr_status": "qr_readable",
        "qr_code": "QR-1",
        "qr_capture_method": method,
    }

    response = _post(client_for(solicitante), payload)

    assert response.status_code == 400
    assert "qr_capture_method" in response.json()
    assert not Incident.objects.exists()


@pytest.mark.parametrize("option", ["qr_unreadable", "no_qr", "not_equipment"])
def test_capture_method_is_rejected_without_a_readable_qr(client_for, solicitante, base, option):
    payload = {
        **base,
        "equipment_qr_status": option,
        "qr_capture_method": "scan",
        "photo": _photo(),
    }

    response = _post(client_for(solicitante), payload)

    assert response.status_code == 400
    assert "qr_capture_method" in response.json()
    assert not Incident.objects.exists()
