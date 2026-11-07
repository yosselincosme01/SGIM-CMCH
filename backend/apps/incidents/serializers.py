from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from rest_framework import serializers

from apps.catalogs.models import CareUnit

from . import planning_services, selectors
from .attachments import prepare_evidence_image
from .models import (
    Incident,
    IncidentAssignment,
    IncidentAttachment,
    IncidentEvent,
    PriorityLevel,
    SupportArea,
)

DESCRIPTION_MIN = 10
DESCRIPTION_MAX = 2000
PRIOR_ACTIONS_MAX = 1000
ASSET_REFERENCE_MAX = 100


# --- Opciones del formulario ---------------------------------------------


class CareUnitOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CareUnit
        fields = ("code", "name", "is_demo")


class SupportAreaOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupportArea
        fields = ("code", "name")


# --- Registro --------------------------------------------------------------


class IncidentCreateSerializer(serializers.Serializer):
    """
    Datos que el usuario puede enviar al registrar una incidencia.

    Cualquier otro campo (estado, código, autor, fechas…) se rechaza: no se permite
    fijar el estado ni otros datos controlados por el sistema desde el formulario.
    """

    care_unit = serializers.SlugRelatedField(
        slug_field="code",
        queryset=CareUnit.objects.filter(is_active=True),
        error_messages={
            "required": "Selecciona la UPS o servicio.",
            "null": "Selecciona la UPS o servicio.",
            "does_not_exist": "La UPS o servicio seleccionado no es válido.",
        },
    )
    support_area = serializers.SlugRelatedField(
        slug_field="code",
        queryset=SupportArea.objects.filter(is_active=True),
        error_messages={
            "required": "Selecciona el área de soporte.",
            "null": "Selecciona el área de soporte.",
            "does_not_exist": "El área de soporte seleccionada no es válida.",
        },
    )
    description = serializers.CharField(
        min_length=DESCRIPTION_MIN,
        max_length=DESCRIPTION_MAX,
        trim_whitespace=True,
        error_messages={
            "required": "Describe el problema.",
            "blank": "Describe el problema.",
            "min_length": f"La descripción debe tener al menos {DESCRIPTION_MIN} caracteres.",
            "max_length": f"La descripción no puede superar {DESCRIPTION_MAX} caracteres.",
        },
    )
    prior_actions = serializers.CharField(
        max_length=PRIOR_ACTIONS_MAX, required=False, allow_blank=True, default=""
    )
    asset_reference = serializers.CharField(
        max_length=ASSET_REFERENCE_MAX, required=False, allow_blank=True, default=""
    )
    photo = serializers.FileField(required=False, allow_null=True, write_only=True)

    def to_internal_value(self, data):
        unexpected = sorted(set(getattr(data, "keys", dict)()) - set(self.fields))
        if unexpected:
            raise serializers.ValidationError(
                {name: ["Este campo no está permitido."] for name in unexpected}
            )
        return super().to_internal_value(data)

    def validate_photo(self, photo):
        if not photo:
            return None
        try:
            # Devuelve la imagen validada y ya sin metadatos (EXIF, GPS...).
            return prepare_evidence_image(photo)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc


# --- Consulta ----------------------------------------------------------------


def display_time_zone() -> ZoneInfo:
    return ZoneInfo(settings.SGIM_DISPLAY_TIME_ZONE)


class LimaDateTimeField(serializers.DateTimeField):
    """
    Fecha en la zona de presentación (America/Lima), sin depender de TIME_ZONE ni del
    sistema operativo. Una fecha sin zona horaria se interpreta como hora de Lima.
    """

    def __init__(self, **kwargs):
        super().__init__(default_timezone=display_time_zone(), **kwargs)


class PriorityLevelSerializer(serializers.ModelSerializer):
    class Meta:
        model = PriorityLevel
        fields = ("code", "name", "order", "description", "is_provisional")
        read_only_fields = fields


class _IncidentBaseSerializer(serializers.ModelSerializer):
    status_label = serializers.CharField(source="get_status_display", read_only=True)
    care_unit = CareUnitOptionSerializer(read_only=True)
    support_area = SupportAreaOptionSerializer(read_only=True)


class IncidentListSerializer(_IncidentBaseSerializer):
    has_attachments = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = (
            "code",
            "status",
            "status_label",
            "care_unit",
            "support_area",
            "created_at",
            "has_attachments",
        )
        read_only_fields = fields

    def get_has_attachments(self, incident) -> bool:
        flag = getattr(incident, "has_attachments_flag", None)
        return flag if flag is not None else incident.attachments.exists()


class AttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = IncidentAttachment
        fields = ("id", "original_name", "content_type", "size", "width", "height", "url")
        read_only_fields = fields

    def get_url(self, attachment) -> str:
        return reverse(
            "v1:incidents:attachment",
            kwargs={"code": attachment.incident.code, "pk": attachment.pk},
        )


def _person(user) -> dict:
    # Datos mínimos: no se exponen correo, roles ni otros datos personales.
    return {"username": user.username, "full_name": user.full_name}


class EventSerializer(serializers.ModelSerializer):
    """Historial para el personal del área: incluye los valores anteriores y nuevos."""

    label = serializers.CharField(source="get_event_type_display", read_only=True)
    actor = serializers.CharField(source="actor.full_name", read_only=True)

    class Meta:
        model = IncidentEvent
        fields = (
            "event_type",
            "label",
            "actor",
            "from_status",
            "to_status",
            "details",
            "created_at",
        )
        read_only_fields = fields


# Eventos internos que el solicitante no ve (provisional, ADR 0004).
REQUESTER_HIDDEN_EVENTS = {
    IncidentEvent.Type.PRIORITY_CHANGED,
    IncidentEvent.Type.TECHNICIAN_CHANGED,
}


class RequesterEventSerializer(serializers.ModelSerializer):
    """Historial para el solicitante: qué pasó y cuándo, sin detalles internos."""

    label = serializers.CharField(source="get_event_type_display", read_only=True)
    actor = serializers.SerializerMethodField()

    class Meta:
        model = IncidentEvent
        fields = ("event_type", "label", "actor", "created_at")
        read_only_fields = fields

    def get_actor(self, event) -> str:
        # El solicitante ve su propio nombre; las acciones internas se atribuyen al área.
        if event.event_type == IncidentEvent.Type.CREATED:
            return event.actor.full_name
        return event.incident.support_area.name


class AssignmentSerializer(serializers.ModelSerializer):
    technician = serializers.SerializerMethodField()
    assigned_by = serializers.SerializerMethodField()
    scheduled_at = LimaDateTimeField(read_only=True)

    class Meta:
        model = IncidentAssignment
        fields = ("id", "technician", "assigned_by", "scheduled_at", "notes", "created_at")
        read_only_fields = fields

    def get_technician(self, assignment) -> dict:
        return _person(assignment.technician)

    def get_assigned_by(self, assignment) -> dict:
        return _person(assignment.assigned_by)


class _IncidentDetailBase(_IncidentBaseSerializer):
    created_by = serializers.SerializerMethodField()
    attachments = AttachmentSerializer(many=True, read_only=True)

    def get_created_by(self, incident) -> dict:
        return _person(incident.created_by)


DETAIL_FIELDS = (
    "code",
    "status",
    "status_label",
    "care_unit",
    "support_area",
    "description",
    "prior_actions",
    "asset_reference",
    "created_by",
    "created_at",
    "attachments",
    "events",
)


class IncidentDetailSerializer(_IncidentDetailBase):
    """
    Detalle para el personal del área (Planificador o técnico autorizado): incluye
    la prioridad, la asignación vigente con sus indicaciones internas y el historial
    completo. ``permissions`` indica qué acciones de planificación están disponibles;
    el backend vuelve a comprobarlas en cada operación.
    """

    events = EventSerializer(many=True, read_only=True)
    priority = PriorityLevelSerializer(read_only=True)
    assignment = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = (*DETAIL_FIELDS, "priority", "assignment", "permissions")
        read_only_fields = fields

    def get_assignment(self, incident) -> dict | None:
        current = selectors.current_assignment(incident)
        return AssignmentSerializer(current).data if current else None

    def get_permissions(self, incident) -> dict:
        user = self.context["request"].user
        can_plan = incident.status in selectors.PLANNABLE_STATUSES and selectors.can_plan_area(
            user, incident.support_area
        )
        return {"can_plan": can_plan}


class RequesterIncidentDetailSerializer(_IncidentDetailBase):
    """
    Detalle para el solicitante: estado y fecha estimada de atención. No incluye la
    prioridad, el técnico ni las indicaciones internas (provisional, ADR 0004).
    """

    events = serializers.SerializerMethodField()
    scheduled_at = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = (*DETAIL_FIELDS, "scheduled_at")
        read_only_fields = fields

    def get_events(self, incident) -> list:
        events = [e for e in incident.events.all() if e.event_type not in REQUESTER_HIDDEN_EVENTS]
        return RequesterEventSerializer(events, many=True).data

    def get_scheduled_at(self, incident) -> str | None:
        current = selectors.current_assignment(incident)
        if current is None:
            return None
        return LimaDateTimeField().to_representation(current.scheduled_at)


# --- Planificación -------------------------------------------------------------


class PlanningListSerializer(_IncidentBaseSerializer):
    """Fila de la bandeja del Planificador."""

    description_excerpt = serializers.SerializerMethodField()
    created_by = serializers.SerializerMethodField()
    priority = PriorityLevelSerializer(read_only=True)
    assignment = serializers.SerializerMethodField()
    has_attachments = serializers.BooleanField(source="has_attachments_flag", read_only=True)

    class Meta:
        model = Incident
        fields = (
            "code",
            "status",
            "status_label",
            "care_unit",
            "support_area",
            "description_excerpt",
            "created_by",
            "created_at",
            "priority",
            "assignment",
            "has_attachments",
        )
        read_only_fields = fields

    def get_description_excerpt(self, incident) -> str:
        text = " ".join(incident.description.split())
        return text if len(text) <= 140 else f"{text[:139].rstrip()}…"

    def get_created_by(self, incident) -> dict:
        return _person(incident.created_by)

    def get_assignment(self, incident) -> dict | None:
        current = selectors.current_assignment(incident)
        if current is None:
            return None
        return {
            "id": current.id,
            "technician": _person(current.technician),
            "scheduled_at": LimaDateTimeField().to_representation(current.scheduled_at),
        }


class TechnicianSerializer(serializers.Serializer):
    username = serializers.CharField(read_only=True)
    full_name = serializers.CharField(read_only=True)
    active_assignments = serializers.IntegerField(read_only=True)
    next_scheduled_at = LimaDateTimeField(read_only=True, allow_null=True)


class _StrictInputSerializer(serializers.Serializer):
    """Rechaza cualquier campo no declarado (estado, autor, fechas del sistema…)."""

    def to_internal_value(self, data):
        unexpected = sorted(set(getattr(data, "keys", dict)()) - set(self.fields))
        if unexpected:
            raise serializers.ValidationError(
                {name: ["Este campo no está permitido."] for name in unexpected}
            )
        return super().to_internal_value(data)


def _priority_field():
    return serializers.SlugRelatedField(
        slug_field="code",
        queryset=PriorityLevel.objects.filter(is_active=True),
        error_messages={
            "required": "Selecciona la prioridad.",
            "null": "Selecciona la prioridad.",
            "does_not_exist": "Selecciona una prioridad válida.",
            "invalid": "Selecciona una prioridad válida.",
        },
    )


def _reason_field():
    return serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        max_length=planning_services.REASON_MAX,
        trim_whitespace=True,
        error_messages={
            "max_length": f"El motivo no puede superar {planning_services.REASON_MAX} caracteres."
        },
    )


class PriorityInputSerializer(_StrictInputSerializer):
    priority = _priority_field()
    reason = _reason_field()


class PlanningInputSerializer(_StrictInputSerializer):
    priority = _priority_field()
    technician = serializers.CharField(
        max_length=150,
        error_messages={
            "required": "Selecciona el técnico responsable.",
            "blank": "Selecciona el técnico responsable.",
        },
    )
    scheduled_at = LimaDateTimeField(
        error_messages={
            "required": "Indica la fecha y hora estimada de atención.",
            "null": "Indica la fecha y hora estimada de atención.",
            "invalid": "Indica una fecha y hora válidas.",
        }
    )
    notes = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        max_length=planning_services.NOTES_MAX,
        trim_whitespace=True,
        error_messages={
            "max_length": (
                f"Las indicaciones no pueden superar {planning_services.NOTES_MAX} caracteres."
            )
        },
    )
    reason = _reason_field()
    expected_assignment = serializers.IntegerField(required=False, allow_null=True, default=None)
