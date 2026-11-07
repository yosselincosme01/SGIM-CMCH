"""
Modelos del registro de incidencias (primera etapa).

Etapas implementadas: registro y consulta (ADR 0003), y planificación y asignación
(ADR 0004). La intervención técnica, la conformidad y el cierre se crearán como
modelos separados; NO se mezclan en ``Incident``.
"""

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q


class SupportArea(models.Model):
    """Área de soporte destinataria: TI, Ingeniería Clínica o Mantenimiento."""

    class Code(models.TextChoices):
        TI = "ti", "TI"
        INGENIERIA_CLINICA = "ingenieria_clinica", "Ingeniería Clínica"
        MANTENIMIENTO = "mantenimiento", "Mantenimiento"

    code = models.CharField("código", max_length=40, unique=True, choices=Code.choices)
    name = models.CharField("nombre", max_length=80)
    is_active = models.BooleanField("activa", default=True)
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="SupportAreaMembership",
        related_name="support_areas",
        blank=True,
        verbose_name="integrantes",
    )

    class Meta:
        verbose_name = "área de soporte"
        verbose_name_plural = "áreas de soporte"
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class SupportAreaMembership(models.Model):
    """
    Integrante de un área de soporte y su función **en esa área**.

    El rol global no basta: para planificar se requiere el rol ``planificador`` y
    ``can_plan``; para recibir asignaciones, el rol ``personal_atencion`` y
    ``can_be_assigned``. Ambas funciones son restrictivas por defecto y se habilitan
    de forma explícita desde el admin. Una persona puede planificar en un área y ser
    técnico en otra.
    """

    area = models.ForeignKey(SupportArea, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="area_memberships"
    )
    can_plan = models.BooleanField(
        "puede planificar",
        default=False,
        help_text="Requiere además el rol Planificador.",
    )
    can_be_assigned = models.BooleanField(
        "puede recibir asignaciones",
        default=False,
        help_text="Requiere además el rol Personal de atención.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "integrante de área"
        verbose_name_plural = "integrantes de área"
        constraints = [
            models.UniqueConstraint(fields=("area", "user"), name="unique_area_membership"),
        ]

    def __str__(self) -> str:
        return f"{self.user} · {self.area}"


class PriorityLevel(models.Model):
    """
    Nivel de prioridad. Catálogo **provisional**: los niveles, sus criterios y sus
    tiempos de atención están pendientes de validación institucional (ADR 0004).
    No hay plazos (SLA) ni reglas automáticas asociadas.
    """

    code = models.SlugField("código", max_length=30, unique=True)
    name = models.CharField("nombre", max_length=40)
    order = models.PositiveSmallIntegerField(
        "orden", unique=True, help_text="1 es el nivel más urgente."
    )
    description = models.CharField("descripción orientativa", max_length=300, blank=True)
    is_active = models.BooleanField("activo", default=True)
    is_provisional = models.BooleanField(
        "provisional", default=True, help_text="Pendiente de validación institucional."
    )

    class Meta:
        verbose_name = "nivel de prioridad"
        verbose_name_plural = "niveles de prioridad"
        ordering = ("order",)

    def __str__(self) -> str:
        return self.name


class Incident(models.Model):
    """Incidencia registrada por un usuario autenticado."""

    class Status(models.TextChoices):
        # Solo la transición inicial de planificación está implementada. Los estados
        # definitivos están pendientes de validación (docs/adr/0004-planificacion.md).
        REGISTRADA = "registrada", "Registrada"
        ASIGNADA = "asignada", "Asignada"

    # null=True es necesario: el código se asigna tras el INSERT (deriva de la clave
    # primaria) en la misma transacción, y UNIQUE admite varios NULL transitorios.
    code = models.CharField(  # noqa: DJ001
        "código",
        max_length=20,
        unique=True,
        null=True,  # se asigna en la misma transacción, justo después de insertar
        editable=False,
    )
    care_unit = models.ForeignKey(
        "catalogs.CareUnit",
        on_delete=models.PROTECT,
        related_name="incidents",
        verbose_name="UPS / servicio",
    )
    support_area = models.ForeignKey(
        SupportArea,
        on_delete=models.PROTECT,
        related_name="incidents",
        verbose_name="área de soporte",
    )
    description = models.TextField("descripción del problema")
    prior_actions = models.TextField("acciones previas", blank=True)
    asset_reference = models.CharField(
        "referencia del equipo o activo",
        max_length=100,
        blank=True,
        help_text="Texto libre (código patrimonial, serie o nombre); sin integración aún.",
    )
    status = models.CharField(
        "estado", max_length=30, choices=Status.choices, default=Status.REGISTRADA, editable=False
    )
    priority = models.ForeignKey(
        PriorityLevel,
        on_delete=models.PROTECT,
        related_name="incidents",
        null=True,
        blank=True,
        editable=False,
        verbose_name="prioridad",
        help_text="Vacía mientras no se evalúe.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="incidents_created",
        verbose_name="registrada por",
        editable=False,
    )
    created_at = models.DateTimeField("registrada", auto_now_add=True)
    updated_at = models.DateTimeField("actualizada", auto_now=True)

    class Meta:
        verbose_name = "incidencia"
        verbose_name_plural = "incidencias"
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=("created_by", "-created_at"), name="incident_creator_idx"),
            models.Index(fields=("support_area", "-created_at"), name="incident_area_idx"),
            models.Index(fields=("support_area", "status"), name="incident_area_status_idx"),
        ]

    def __str__(self) -> str:
        return self.code or f"Incidencia #{self.pk}"


def attachment_upload_to(instance: IncidentAttachment, filename: str) -> str:
    """Nombre aleatorio: nunca se usa el nombre de archivo enviado por el usuario."""
    return f"incidents/{instance.uploaded_at:%Y/%m}/{uuid.uuid4().hex}.{instance.extension}"


class IncidentAttachment(models.Model):
    """Imagen de evidencia (opcional). Se sirve solo mediante un endpoint con permisos."""

    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField("archivo", upload_to=attachment_upload_to, max_length=200)
    original_name = models.CharField("nombre original", max_length=150)
    content_type = models.CharField("tipo de contenido", max_length=50)
    extension = models.CharField(max_length=10)
    size = models.PositiveIntegerField("tamaño (bytes)")
    width = models.PositiveIntegerField("ancho")
    height = models.PositiveIntegerField("alto")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+"
    )
    uploaded_at = models.DateTimeField("subido")

    class Meta:
        verbose_name = "evidencia"
        verbose_name_plural = "evidencias"
        ordering = ("uploaded_at", "id")

    def __str__(self) -> str:
        return self.original_name


class IncidentEvent(models.Model):
    """
    Trazabilidad: registro inmutable de lo que ocurre con una incidencia
    (creación ahora; cambios de estado, asignaciones, etc. en etapas futuras).
    """

    class Type(models.TextChoices):
        CREATED = "created", "Registrada"
        PRIORITY_CHANGED = "priority_changed", "Prioridad actualizada"
        ASSIGNED = "assigned", "Atención programada"
        TECHNICIAN_CHANGED = "technician_changed", "Técnico responsable reasignado"
        SCHEDULE_CHANGED = "schedule_changed", "Atención reprogramada"

    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField("tipo", max_length=40, choices=Type.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+", verbose_name="autor"
    )
    from_status = models.CharField(max_length=30, blank=True)
    to_status = models.CharField(max_length=30, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "evento de incidencia"
        verbose_name_plural = "eventos de incidencia"
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=("incident", "created_at"), name="incident_event_idx")]

    def __str__(self) -> str:
        return f"{self.incident} · {self.get_event_type_display()}"


class IncidentAssignment(models.Model):
    """
    Asignación de una incidencia a un técnico, con fecha y hora estimada de atención.

    Las asignaciones no se editan: reasignar o reprogramar cierra la vigente y crea
    una nueva, así se conserva el historial completo. Solo una puede estar vigente.
    Una persona responsable por asignación (provisional); no limita que otros
    técnicos intervengan en etapas futuras.
    """

    incident = models.ForeignKey(Incident, on_delete=models.CASCADE, related_name="assignments")
    technician = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="incident_assignments",
        verbose_name="técnico responsable",
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        verbose_name="programada por",
    )
    scheduled_at = models.DateTimeField("fecha y hora estimada de atención")
    notes = models.TextField("indicaciones internas", blank=True)
    reason = models.TextField(
        "motivo del cambio", blank=True, help_text="Obligatorio al reasignar o reprogramar."
    )
    is_current = models.BooleanField("vigente", default=True)
    created_at = models.DateTimeField("creada", auto_now_add=True)
    ended_at = models.DateTimeField("reemplazada", null=True, blank=True)

    class Meta:
        verbose_name = "asignación"
        verbose_name_plural = "asignaciones"
        ordering = ("created_at", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("incident",),
                condition=Q(is_current=True),
                name="one_current_assignment_per_incident",
            ),
            models.CheckConstraint(
                condition=Q(is_current=True, ended_at__isnull=True)
                | Q(is_current=False, ended_at__isnull=False),
                name="assignment_end_matches_current",
            ),
        ]
        indexes = [
            models.Index(
                fields=("technician", "is_current", "scheduled_at"),
                name="assignment_technician_idx",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.incident} · {self.technician}"
