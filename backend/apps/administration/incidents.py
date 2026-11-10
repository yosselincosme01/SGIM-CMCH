"""
Consulta global de incidencias para el Administrador, de solo lectura (ADR 0009).

- Ve todas las incidencias de todas las áreas: lista con filtros y detalle.
- **Sin evidencia:** no se entregan fotografías ni enlaces de descarga. Solo cuántas
  hay. La descarga protegida (``/incidents/<código>/attachments/<id>/``) sigue
  exigiendo una función en el área, que el Administrador no tiene.
- **Sin acciones:** no hay ``permissions`` ni endpoints de escritura. La visibilidad
  global no da permisos para planificar, atender ni verificar (ADR 0007 y 0008).
- Incluye el nombre del solicitante, igual que los reportes actuales.
"""

from datetime import date, datetime, time, timedelta

from django.db.models import Exists, OuterRef, QuerySet
from rest_framework import serializers

from apps.incidents import selectors
from apps.incidents.models import Incident, IncidentAttachment
from apps.incidents.serializers import (
    IncidentDetailSerializer,
    InterventionSerializer,
    PlanningListSerializer,
    display_time_zone,
)


class AdminInterventionSerializer(InterventionSerializer):
    """Intervención en texto, con el número de fotografías en vez de las fotografías."""

    photo_count = serializers.SerializerMethodField()
    photos = None

    class Meta(InterventionSerializer.Meta):
        fields = tuple(f for f in InterventionSerializer.Meta.fields if f != "photos") + (
            "photo_count",
        )
        read_only_fields = fields

    def get_photo_count(self, intervention) -> int:
        return len(intervention.photos.all())


class AdminIncidentDetailSerializer(IncidentDetailSerializer):
    """Detalle de solo lectura: sin evidencia descargable y sin acciones disponibles."""

    interventions = AdminInterventionSerializer(many=True, read_only=True)
    attachment_count = serializers.SerializerMethodField()
    # Se retiran del detalle: ni evidencia descargable ni acciones disponibles.
    attachments = None
    permissions = None

    class Meta(IncidentDetailSerializer.Meta):
        fields = tuple(
            f
            for f in IncidentDetailSerializer.Meta.fields
            if f not in ("attachments", "permissions")
        ) + ("attachment_count",)
        read_only_fields = fields

    def get_attachment_count(self, incident) -> int:
        return sum(1 for a in incident.attachments.all() if a.intervention_id is None)


class AdminIncidentListSerializer(PlanningListSerializer):
    """Fila de la consulta global (los mismos datos que la bandeja, sin acciones)."""


def global_incidents() -> QuerySet[Incident]:
    return (
        selectors.base_queryset()
        .annotate(
            last_result=selectors.latest_intervention_result_subquery(),
            pending_verification_flag=selectors.pending_verification_expression(),
            has_attachments_flag=Exists(
                IncidentAttachment.objects.filter(
                    incident=OuterRef("pk"), intervention__isnull=True
                )
            ),
        )
        .prefetch_related(selectors.current_assignment_prefetch())
    )


def global_detail_queryset() -> QuerySet[Incident]:
    return (
        selectors.base_queryset()
        .select_related("closing_intervention__technician")
        .prefetch_related(
            "attachments",
            "events__actor",
            "interventions__technician",
            "interventions__photos",
            "interventions__verification__verified_by",
            selectors.current_assignment_prefetch(),
        )
    )


def registration_range(params) -> tuple[datetime | None, datetime | None]:
    """
    ``date_from``/``date_to`` opcionales (AAAA-MM-DD) como días completos en hora de
    Lima, con la misma regla que los indicadores. Sin fechas, no se filtra.
    """
    errors = {}
    days = {}
    for name in ("date_from", "date_to"):
        raw = (params.get(name) or "").strip()
        if not raw:
            days[name] = None
            continue
        try:
            days[name] = date.fromisoformat(raw)
        except ValueError:
            errors[name] = "Fecha no válida (AAAA-MM-DD)."
    if not errors and days["date_from"] and days["date_to"] and days["date_from"] > days["date_to"]:
        errors["date_from"] = "La fecha inicial no puede ser posterior a la final."
    if errors:
        raise serializers.ValidationError(errors)
    zone = display_time_zone()
    start = (
        datetime.combine(days["date_from"], time.min, tzinfo=zone) if days["date_from"] else None
    )
    end = (
        datetime.combine(days["date_to"] + timedelta(days=1), time.min, tzinfo=zone)
        if days["date_to"]
        else None
    )
    return start, end
