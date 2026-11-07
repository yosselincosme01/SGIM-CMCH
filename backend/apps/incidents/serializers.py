from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from rest_framework import serializers

from apps.catalogs.models import CareUnit

from . import attention_services, planning_services, selectors
from .attachments import prepare_evidence_image
from .identification import (
    PHOTO_REQUIRED,
    QR_CODE_MAX,
    QR_TOO_LONG,
    clean_equipment_identification,
    requires_photo,
)
from .models import (
    Incident,
    IncidentAssignment,
    IncidentAttachment,
    IncidentEvent,
    IncidentIntervention,
    IncidentVerification,
    PriorityLevel,
    SupportArea,
)

DESCRIPTION_MIN = 10
DESCRIPTION_MAX = 2000
PRIOR_ACTIONS_MAX = 1000


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


class RequiredChoiceField(serializers.ChoiceField):
    """Opción obligatoria: un valor vacío (frecuente en multipart) cuenta como ausente."""

    def to_internal_value(self, data):
        if data in ("", None):
            self.fail("required")
        return super().to_internal_value(data)


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
    equipment_qr_status = RequiredChoiceField(
        choices=[
            (value, label)
            for value, label in Incident.EquipmentQrStatus.choices
            if value in Incident.EquipmentQrStatus.public_values()
        ],
        error_messages={
            "required": "Indica si el equipo tiene código QR.",
            "null": "Indica si el equipo tiene código QR.",
            "blank": "Indica si el equipo tiene código QR.",
            "invalid_choice": "Selecciona una opción válida de identificación del equipo.",
        },
    )
    # Sin recorte automático: la validación cruzada decide si el código corresponde.
    qr_code = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        trim_whitespace=False,
        max_length=QR_CODE_MAX + 50,  # el límite exacto se aplica tras quitar espacios
        error_messages={"max_length": QR_TOO_LONG},
    )
    # Dato declarado por el cliente ("scan" si usó la cámara); ver identification.py.
    qr_capture_method = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=10
    )
    photo = serializers.FileField(required=False, allow_null=True, write_only=True)

    def to_internal_value(self, data):
        unexpected = sorted(set(getattr(data, "keys", dict)()) - set(self.fields))
        if unexpected:
            raise serializers.ValidationError(
                {name: ["Este campo no está permitido."] for name in unexpected}
            )
        return super().to_internal_value(data)

    def validate(self, attrs):
        try:
            status, qr_code, method = clean_equipment_identification(
                attrs.get("equipment_qr_status"),
                attrs.get("qr_code"),
                attrs.get("qr_capture_method"),
            )
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict) from exc
        if requires_photo(status) and not attrs.get("photo"):
            raise serializers.ValidationError({"photo": [PHOTO_REQUIRED]})
        attrs["equipment_qr_status"] = status
        attrs["qr_code"] = qr_code
        attrs["qr_capture_method"] = method
        return attrs

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
    IncidentEvent.Type.INTERVENTION,
    IncidentEvent.Type.VERIFIED,
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
    # El contenido del QR se entrega como texto; el cliente nunca debe abrirlo como URL.
    equipment_qr_status_label = serializers.CharField(
        source="get_equipment_qr_status_display", read_only=True
    )
    attachments = serializers.SerializerMethodField()

    def get_created_by(self, incident) -> dict:
        return _person(incident.created_by)

    def get_attachments(self, incident) -> list:
        # Evidencia del registro. Las fotos técnicas van con su intervención.
        registration = [a for a in incident.attachments.all() if a.intervention_id is None]
        return AttachmentSerializer(registration, many=True).data


DETAIL_FIELDS = (
    "code",
    "status",
    "status_label",
    "care_unit",
    "support_area",
    "description",
    "prior_actions",
    "equipment_qr_status",
    "equipment_qr_status_label",
    "qr_code",
    "created_by",
    "created_at",
    "attachments",
    "events",
)


class VerificationSerializer(serializers.ModelSerializer):
    result_label = serializers.CharField(source="get_result_display", read_only=True)
    verified_by = serializers.SerializerMethodField()

    class Meta:
        model = IncidentVerification
        fields = ("id", "result", "result_label", "observations", "verified_by", "created_at")
        read_only_fields = fields

    def get_verified_by(self, verification) -> dict:
        return _person(verification.verified_by)


class InterventionSerializer(serializers.ModelSerializer):
    """Intervención técnica con su evidencia y, si cerró el ticket, su verificación."""

    result_label = serializers.CharField(source="get_result_display", read_only=True)
    technician = serializers.SerializerMethodField()
    photos = AttachmentSerializer(many=True, read_only=True)
    is_closure = serializers.SerializerMethodField()
    verification = serializers.SerializerMethodField()

    class Meta:
        model = IncidentIntervention
        fields = (
            "id",
            "assignment",
            "technician",
            "result",
            "result_label",
            "diagnosis",
            "actions_taken",
            "used_parts",
            "used_parts_detail",
            "parts_required",
            "parts_required_detail",
            "unresolved_reason",
            "observations",
            "photos",
            "is_closure",
            "verification",
            "created_at",
        )
        read_only_fields = fields

    def get_technician(self, intervention) -> dict:
        return _person(intervention.technician)

    def get_is_closure(self, intervention) -> bool:
        return intervention.result == IncidentIntervention.Result.SOLVED

    def get_verification(self, intervention) -> dict | None:
        verification = getattr(intervention, "verification", None)
        return VerificationSerializer(verification).data if verification else None


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
    interventions = InterventionSerializer(many=True, read_only=True)
    closure = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = (
            *DETAIL_FIELDS,
            "priority",
            "assignment",
            "interventions",
            "closure",
            "permissions",
        )
        read_only_fields = fields

    def get_closure(self, incident) -> dict | None:
        """Cierre técnico vigente y su verificación (``None`` si está abierta)."""
        closing = incident.closing_intervention
        if closing is None:
            return None
        verification = selectors.closing_verification(incident)
        return {
            "intervention": closing.pk,
            "closed_by": _person(closing.technician),
            "closed_at": LimaDateTimeField().to_representation(closing.created_at),
            "pending_verification": verification is None,
            "verification": VerificationSerializer(verification).data if verification else None,
        }

    def get_assignment(self, incident) -> dict | None:
        current = selectors.current_assignment(incident)
        return AssignmentSerializer(current).data if current else None

    def get_permissions(self, incident) -> dict:
        user = self.context["request"].user
        planner = selectors.can_plan_area(user, incident.support_area)
        verification = selectors.closing_verification(incident) if planner else None
        closed = incident.status == Incident.Status.CERRADA
        return {
            "can_plan": planner and incident.status in selectors.PLANNABLE_STATUSES,
            "can_intervene": selectors.can_intervene(user, incident),
            "can_verify": planner and closed and verification is None,
            "can_reopen": planner
            and closed
            and verification is not None
            and verification.result == IncidentVerification.Result.NOT_CONFORMING,
        }


class RequesterIncidentDetailSerializer(_IncidentDetailBase):
    """
    Detalle para el solicitante: estado y fecha estimada de atención. No incluye la
    prioridad, el técnico ni las indicaciones internas (provisional, ADR 0004).
    """

    events = serializers.SerializerMethodField()
    scheduled_at = serializers.SerializerMethodField()
    closed_at = serializers.SerializerMethodField()

    class Meta:
        model = Incident
        fields = (*DETAIL_FIELDS, "scheduled_at", "closed_at")
        read_only_fields = fields

    def get_closed_at(self, incident) -> str | None:
        closing = incident.closing_intervention
        return LimaDateTimeField().to_representation(closing.created_at) if closing else None

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
            "last_result",
            "pending_verification",
        )
        read_only_fields = fields

    last_result = serializers.SerializerMethodField()
    pending_verification = serializers.SerializerMethodField()

    def get_last_result(self, incident) -> dict | None:
        value = getattr(incident, "last_result", None)
        if not value:
            return None
        return {"code": value, "label": IncidentIntervention.Result(value).label}

    def get_pending_verification(self, incident) -> bool:
        return getattr(incident, "pending_verification_flag", False)

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


# --- Atención -------------------------------------------------------------------


class AttentionListSerializer(PlanningListSerializer):
    """Fila de la bandeja del Personal de Atención (mismos datos que la del Planificador)."""


_BOOLEAN_CHOICE = {
    "required": "Indica Sí o No.",
    "null": "Indica Sí o No.",
    "invalid_choice": "Indica Sí o No.",
}


class InterventionInputSerializer(_StrictInputSerializer):
    """
    Datos de una intervención (multipart). Los textos se validan en el servicio, que
    también decide los campos condicionales. Las fotos pasan por el mismo control que
    la evidencia del registro: tipo real, tamaño, dimensiones y sin metadatos.
    """

    assignment = serializers.IntegerField(
        error_messages={
            "required": "Falta la asignación vigente.",
            "invalid": "Asignación inválida.",
        }
    )
    diagnosis = serializers.CharField(required=False, allow_blank=True, default="", max_length=5000)
    actions_taken = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=5000
    )
    result = serializers.CharField(required=False, allow_blank=True, default="", max_length=20)
    # "true"/"false" explícitos: en multipart, un booleano ausente no debe valer "No".
    used_parts = serializers.ChoiceField(choices=["true", "false"], error_messages=_BOOLEAN_CHOICE)
    used_parts_detail = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=5000
    )
    parts_required = serializers.ChoiceField(
        choices=["true", "false"], error_messages=_BOOLEAN_CHOICE
    )
    parts_required_detail = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=5000
    )
    unresolved_reason = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=5000
    )
    observations = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=5000
    )
    photos = serializers.ListField(
        child=serializers.FileField(), required=False, default=list, allow_empty=True
    )

    def validate_used_parts(self, value) -> bool:
        return value == "true"

    def validate_parts_required(self, value) -> bool:
        return value == "true"

    def validate_photos(self, photos):
        if len(photos) > attention_services.PHOTOS_MAX:
            raise serializers.ValidationError(attention_services.TOO_MANY_PHOTOS)
        prepared = []
        for photo in photos:
            try:
                prepared.append(prepare_evidence_image(photo))
            except DjangoValidationError as exc:
                raise serializers.ValidationError(exc.messages) from exc
        return prepared


class VerificationInputSerializer(_StrictInputSerializer):
    result = serializers.CharField(
        max_length=20, error_messages={"required": "Selecciona Conforme o No conforme."}
    )
    observations = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=5000
    )


class ReopenInputSerializer(_StrictInputSerializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="", max_length=5000)
