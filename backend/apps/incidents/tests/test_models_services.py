import re
import threading

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction

from apps.catalogs.models import CareUnit
from apps.incidents import services
from apps.incidents.attachments import prepare_evidence_image
from apps.incidents.models import Incident, IncidentAttachment, IncidentEvent, SupportArea
from apps.incidents.services import create_incident, format_incident_code

from .conftest import image_bytes, upload

pytestmark = pytest.mark.django_db

CODE_PATTERN = re.compile(r"^INC-\d{4}-\d{6,}$")


def _create(user, care_unit, area, **extra):
    return create_incident(
        user=user,
        care_unit=care_unit,
        support_area=area,
        description="Descripción ficticia de prueba suficientemente larga.",
        **extra,
    )


# --- Modelo --------------------------------------------------------------


def test_support_areas_are_created_by_migration():
    assert set(SupportArea.objects.values_list("code", flat=True)) == {
        "ti",
        "ingenieria_clinica",
        "mantenimiento",
    }


def test_foreign_keys_point_to_custom_user_model():
    for field_name in ("created_by",):
        field = Incident._meta.get_field(field_name)
        assert field.remote_field.model is get_user_model()
    assert settings.AUTH_USER_MODEL == "accounts.User"


def test_users_are_not_linked_to_care_units():
    relations = {f.related_model for f in get_user_model()._meta.get_fields() if f.is_relation}
    assert CareUnit not in relations


def test_only_initial_status_is_implemented():
    assert Incident.Status.values == ["registrada"]


def test_future_workflow_entities_are_not_mixed_into_incident():
    names = {field.name for field in Incident._meta.get_fields()}
    assert not names & {"assigned_to", "technician", "diagnosis", "rating", "closed_at"}


def test_code_must_be_unique(solicitante, care_unit, area_ti):
    incident = _create(solicitante, care_unit, area_ti)
    duplicate = Incident(
        care_unit=care_unit,
        support_area=area_ti,
        description="x" * 20,
        created_by=solicitante,
        code=incident.code,
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        duplicate.save()


# --- Servicio de registro ---------------------------------------------------


def test_format_incident_code():
    assert format_incident_code(2026, 7) == "INC-2026-000007"
    assert format_incident_code(2026, 1234567) == "INC-2026-1234567"


def test_create_incident_sets_code_author_status_and_event(solicitante, care_unit, area_ti):
    incident = _create(solicitante, care_unit, area_ti, asset_reference="DEMO-01")

    assert CODE_PATTERN.match(incident.code)
    assert incident.created_by == solicitante
    assert incident.status == Incident.Status.REGISTRADA
    event = incident.events.get()
    assert event.event_type == IncidentEvent.Type.CREATED
    assert event.actor == solicitante
    assert event.to_status == "registrada"
    assert event.details == {"has_attachment": False}


def test_codes_are_unique_across_many_incidents(solicitante, care_unit, area_ti):
    codes = [_create(solicitante, care_unit, area_ti).code for _ in range(25)]

    assert len(set(codes)) == 25
    assert all(CODE_PATTERN.match(code) for code in codes)


def test_attachment_is_stored_with_random_name(solicitante, care_unit, area_ti):
    photo = upload("mi foto con nombre real.png", image_bytes("PNG"))

    incident = _create(solicitante, care_unit, area_ti, evidence=prepare_evidence_image(photo))

    attachment = incident.attachments.get()
    assert attachment.original_name == "mi foto con nombre real.png"
    assert "mi foto" not in attachment.file.name
    assert re.search(r"incidents/\d{4}/\d{2}/[0-9a-f]{32}\.png$", attachment.file.name)
    assert attachment.uploaded_by == solicitante
    assert incident.events.get().details == {"has_attachment": True}


def test_failure_rolls_back_and_removes_stored_file(
    solicitante, care_unit, area_ti, monkeypatch, tmp_path
):
    def fail(*args, **kwargs):
        raise RuntimeError("fallo simulado")

    monkeypatch.setattr(IncidentEvent.objects, "create", fail)
    photo = upload("foto.png", image_bytes("PNG"))

    with pytest.raises(RuntimeError):
        _create(solicitante, care_unit, area_ti, evidence=prepare_evidence_image(photo))

    assert Incident.objects.count() == 0
    assert IncidentAttachment.objects.count() == 0
    stored = [p for p in (tmp_path / "media").rglob("*") if p.is_file()]
    assert stored == []


def test_raw_upload_is_never_stored(solicitante, care_unit, area_ti):
    """El servicio solo acepta evidencias preparadas (validadas y sin metadatos)."""
    with pytest.raises(TypeError):
        _create(solicitante, care_unit, area_ti, evidence=upload("a.png", image_bytes("PNG")))

    assert Incident.objects.count() == 0


@pytest.mark.django_db(transaction=True)
@pytest.mark.skipif(
    connection.vendor != "postgresql", reason="Concurrencia real solo en PostgreSQL"
)
def test_concurrent_creation_never_duplicates_codes(solicitante, care_unit, area_ti):
    codes, errors = [], []

    def worker():
        try:
            codes.append(_create(solicitante, care_unit, area_ti).code)
        except Exception as exc:  # pragma: no cover - se informa en la aserción
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert len(codes) == len(set(codes)) == 10


def test_service_module_exposes_single_entry_point():
    assert callable(services.create_incident)
