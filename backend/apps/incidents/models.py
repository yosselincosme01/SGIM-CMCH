"""
Modelos del registro de incidencias (primera etapa).

Alcance de esta etapa: registro y consulta. Las futuras entidades de asignación,
intervención técnica, revisión y satisfacción se crearán como modelos separados
(ver docs/adr/0003-incidencias.md); NO se mezclan en ``Incident``.
"""

import uuid

from django.conf import settings
from django.db import models


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
    Integrantes de un área de soporte. Permite que el área consulte sus incidencias
    sin depender de qué planificador está de turno. Lo gestiona un superusuario desde
    el admin; los criterios definitivos están pendientes de validación.
    """

    area = models.ForeignKey(SupportArea, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="area_memberships"
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


class Incident(models.Model):
    """Incidencia registrada por un usuario autenticado."""

    class Status(models.TextChoices):
        # Solo el estado inicial está implementado. Los estados futuros son una
        # propuesta documentada en docs/adr/0003-incidencias.md, pendiente de validar.
        REGISTRADA = "registrada", "Registrada"

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
