"""Fixtures de administración. Solo datos ficticios."""

import io
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.roles import Role
from apps.catalogs.models import CareUnit
from apps.incidents import attention_services, planning_services
from apps.incidents.attachments import prepare_evidence_image
from apps.incidents.models import PriorityLevel, SupportArea, SupportAreaMembership
from apps.incidents.services import create_incident

PASSWORD = "Clave-de-prueba-2026"  # noqa: S105 - contraseña ficticia de pruebas


@pytest.fixture(autouse=True)
def _media_root(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / "media"


@pytest.fixture
def make_user(db):
    def _make_user(
        username,
        *roles,
        plans=(),
        assigned=(),
        is_superuser=False,
        is_staff=False,
        is_active=True,
    ):
        user = get_user_model().objects.create_user(
            username=username,
            password=PASSWORD,
            email=f"{username}@example.test",
            first_name=username.split(".")[0].title(),
            last_name="Prueba",
            is_superuser=is_superuser,
            is_staff=is_staff,
            is_active=is_active,
        )
        user.groups.add(*Group.objects.filter(name__in=roles))
        for code in {*plans, *assigned}:
            SupportAreaMembership.objects.create(
                area=SupportArea.objects.get(code=code),
                user=user,
                can_plan=code in plans,
                can_be_assigned=code in assigned,
            )
        return user

    return _make_user


@pytest.fixture
def admin_user(make_user):
    return make_user("admin.prueba", Role.ADMINISTRADOR)


@pytest.fixture
def client_for():
    def _client_for(user, *, enforce_csrf=False):
        client = APIClient(enforce_csrf_checks=enforce_csrf)
        if user is not None:
            client.force_login(user)
        return client

    return _client_for


def photo():
    buffer = io.BytesIO()
    Image.new("RGB", (24, 16), (154, 19, 49)).save(buffer, format="PNG")
    return prepare_evidence_image(SimpleUploadedFile("e.png", buffer.getvalue(), "image/png"))


class Builder:
    """Crea incidencias ficticias en distintas etapas del ciclo usando los servicios reales."""

    def __init__(self, make_user):
        self.requester = make_user("sol.prueba", Role.SOLICITANTE)
        self.planners = {
            code: make_user(f"plan.{code}", Role.PLANIFICADOR, plans=(code,))
            for code in ("ti", "mantenimiento")
        }
        self.techs = {
            code: make_user(f"tec.{code}", Role.PERSONAL_ATENCION, assigned=(code,))
            for code in ("ti", "mantenimiento")
        }
        self.unit, _ = CareUnit.objects.get_or_create(
            code="demo-emergencia", defaults={"name": "[DEMO] Emergencia", "is_demo": True}
        )

    def registered(self, area="ti", text="Incidencia ficticia de reporte"):
        return create_incident(
            user=self.requester,
            care_unit=self.unit,
            support_area=SupportArea.objects.get(code=area),
            description=text,
            equipment_qr_status="qr_readable",
            qr_code=f"QR-{area}",
        )

    def assigned(self, area="ti", **kwargs):
        incident = self.registered(area, **kwargs)
        planning_services.schedule_attention(
            incident=incident,
            actor=self.planners[area],
            priority=PriorityLevel.objects.get(code="alta"),
            technician=self.techs[area],
            scheduled_at=timezone.now() + timedelta(days=1),
        )
        incident.refresh_from_db()
        return incident

    def intervene(self, incident, result="solved", **fields):
        area = incident.support_area.code
        data = {
            "diagnosis": "Diagnóstico ficticio.",
            "actions_taken": "Acción ficticia.",
            "result": result,
            "used_parts": False,
            "parts_required": False,
        }
        if result != "solved":
            data["unresolved_reason"] = "Motivo ficticio suficiente."
        data.update(fields)
        attention_services.register_intervention(
            incident=incident,
            actor=self.techs[area],
            expected_assignment_id=incident.assignments.get(is_current=True).pk,
            photos=[photo()],
            **data,
        )
        incident.refresh_from_db()
        return incident

    def verify(self, incident, result, observations=""):
        attention_services.verify_closure(
            incident=incident,
            actor=self.planners[incident.support_area.code],
            result=result,
            observations=observations,
        )
        incident.refresh_from_db()
        return incident

    def reopen(self, incident):
        attention_services.reopen_incident(
            incident=incident,
            actor=self.planners[incident.support_area.code],
            reason="Reapertura ficticia suficiente.",
        )
        incident.refresh_from_db()
        return incident


@pytest.fixture
def builder(make_user):
    return Builder(make_user)
