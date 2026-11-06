from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from rest_framework import serializers

from apps.catalogs.models import CareUnit

from .attachments import prepare_evidence_image
from .models import Incident, IncidentAttachment, IncidentEvent, SupportArea

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
        return incident.attachments.exists()


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


class EventSerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="get_event_type_display", read_only=True)
    actor = serializers.CharField(source="actor.full_name", read_only=True)

    class Meta:
        model = IncidentEvent
        fields = ("event_type", "label", "actor", "created_at")
        read_only_fields = fields


class IncidentDetailSerializer(_IncidentBaseSerializer):
    created_by = serializers.SerializerMethodField()
    attachments = AttachmentSerializer(many=True, read_only=True)
    events = EventSerializer(many=True, read_only=True)

    class Meta:
        model = Incident
        fields = (
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
        read_only_fields = fields

    def get_created_by(self, incident) -> dict:
        # Datos mínimos: no se exponen correo, roles ni otros datos personales.
        return {
            "username": incident.created_by.username,
            "full_name": incident.created_by.full_name,
        }
