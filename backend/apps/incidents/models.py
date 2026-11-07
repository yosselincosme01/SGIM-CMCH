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


class EquipmentQrStatus(models.TextChoices):
    """Respuesta a "¿El equipo tiene código QR?" (ADR 0005)."""

    QR_READABLE = "qr_readable", "Tiene QR y puedo leerlo"
    QR_UNREADABLE = "qr_unreadable", "Tiene QR, pero no puedo leerlo"
    NO_QR = "no_qr", "El equipo no tiene QR"
    NOT_EQUIPMENT = "not_equipment", "No corresponde a un equipo"
    # Solo para incidencias anteriores a la identificación por QR. La API no lo acepta.
    UNSPECIFIED = "unspecified", "Sin dato de identificación (incidencia anterior)"

    @classmethod
    def public_values(cls) -> list[str]:
        """Opciones que puede elegir quien registra una incidencia."""
        return [value for value in cls.values if value != cls.UNSPECIFIED]


class QrCaptureMethod(models.TextChoices):
    MANUAL = "manual", "Escrito por el usuario"
    # Reservado para la futura lectura con cámara. La API no lo acepta todavía.
    SCAN = "scan", "Leído con la cámara"


class Incident(models.Model):
    """Incidencia registrada por un usuario autenticado."""

    class Status(models.TextChoices):
        """
        Estado operativo del ticket (ADR 0006). Transiciones permitidas:

        registrada ──programar──▶ asignada ──intervención "Solucionado"──▶ cerrada
                                    ▲  │ (reprogramar/reasignar: sigue asignada)
                                    │  └─ intervención "En proceso"/"No solucionado":
                                    │     sigue asignada (pendiente para el Planificador)
        reabierta ◀──reabrir (tras verificación "No conforme")── cerrada
            └──programar──▶ asignada

        El resultado de cada intervención y el de la verificación se guardan aparte
        (IncidentIntervention, IncidentVerification): no son estados del ticket.
        """

        REGISTRADA = "registrada", "Registrada"
        ASIGNADA = "asignada", "Asignada"
        CERRADA = "cerrada", "Cerrada"
        REABIERTA = "reabierta", "Reabierta"

    # Alias para usar Incident.EquipmentQrStatus / Incident.QrCaptureMethod.
    EquipmentQrStatus = EquipmentQrStatus
    QrCaptureMethod = QrCaptureMethod

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
        "referencia del equipo (legado)",
        max_length=100,
        blank=True,
        editable=False,
        help_text=(
            "Campo legado: no se usa en registros nuevos ni en la API. Se eliminará al "
            "integrar el inventario institucional (ADR 0005)."
        ),
    )
    equipment_qr_status = models.CharField(
        "identificación del equipo",
        max_length=20,
        choices=EquipmentQrStatus.choices,
        editable=False,
    )
    qr_code = models.CharField(
        "contenido del QR",
        max_length=255,
        blank=True,
        editable=False,
        help_text="Texto leído, sin interpretar. Pendiente de validar contra el inventario.",
    )
    qr_capture_method = models.CharField(
        "forma de captura del QR",
        max_length=10,
        choices=QrCaptureMethod.choices,
        blank=True,
        editable=False,
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
    # Cierre técnico vigente: la intervención "Solucionado" que cerró el ciclo actual.
    # Al reabrir vuelve a NULL; los cierres anteriores siguen en sus intervenciones.
    closing_intervention = models.OneToOneField(
        "IncidentIntervention",
        on_delete=models.PROTECT,
        related_name="closed_incident",
        null=True,
        blank=True,
        editable=False,
        verbose_name="cierre técnico vigente",
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
            models.Index(
                fields=("qr_code",), name="incident_qr_code_idx", condition=~Q(qr_code="")
            ),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(equipment_qr_status__in=EquipmentQrStatus.values),
                name="incident_qr_status_valid",
            ),
            # Solo un QR legible lleva contenido (sin espacios en los extremos) y forma
            # de captura; las demás opciones no guardan código.
            models.CheckConstraint(
                condition=(
                    Q(
                        equipment_qr_status="qr_readable",
                        qr_capture_method__in=QrCaptureMethod.values,
                    )
                    & ~Q(qr_code="")
                    & ~Q(qr_code__regex=r"^\s|\s$")
                )
                | (~Q(equipment_qr_status="qr_readable") & Q(qr_code="", qr_capture_method="")),
                name="incident_qr_code_matches_status",
            ),
            # Cerrada si y solo si hay un cierre técnico vigente.
            models.CheckConstraint(
                condition=Q(status="cerrada", closing_intervention__isnull=False)
                | (~Q(status="cerrada") & Q(closing_intervention__isnull=True)),
                name="incident_closed_has_closure",
            ),
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
    # Vacío: evidencia del registro. Con valor: evidencia técnica de una intervención,
    # que solo ve el personal del área.
    intervention = models.ForeignKey(
        "IncidentIntervention",
        on_delete=models.PROTECT,
        related_name="photos",
        null=True,
        blank=True,
        verbose_name="intervención",
    )

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
        INTERVENTION = "intervention", "Intervención registrada"
        CLOSED = "closed", "Cerrada (cierre técnico)"
        VERIFIED = "verified", "Verificación registrada"
        REOPENED = "reopened", "Reabierta"

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


class IncidentIntervention(models.Model):
    """
    Intervención técnica del Personal de Atención (ADR 0006). Se registra sobre la
    asignación vigente y **no se edita ni se elimina**: cada nueva atención es una
    intervención nueva.
    """

    class Result(models.TextChoices):
        SOLVED = "solved", "Solucionado"
        IN_PROGRESS = "in_progress", "En proceso"
        NOT_SOLVED = "not_solved", "No solucionado"

    incident = models.ForeignKey(Incident, on_delete=models.PROTECT, related_name="interventions")
    assignment = models.ForeignKey(
        IncidentAssignment,
        on_delete=models.PROTECT,
        related_name="interventions",
        verbose_name="asignación",
    )
    technician = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="incident_interventions",
        verbose_name="registrada por",
    )
    diagnosis = models.TextField("diagnóstico técnico")
    actions_taken = models.TextField("acciones realizadas")
    result = models.CharField("resultado", max_length=20, choices=Result.choices)
    used_parts = models.BooleanField("se utilizaron repuestos")
    used_parts_detail = models.TextField("repuestos utilizados", blank=True)
    parts_required = models.BooleanField("se requieren repuestos")
    parts_required_detail = models.TextField("repuestos requeridos", blank=True)
    unresolved_reason = models.TextField(
        "motivo", blank=True, help_text="Obligatorio si no quedó solucionado."
    )
    observations = models.TextField("observaciones", blank=True)
    created_at = models.DateTimeField("registrada", auto_now_add=True)

    class Meta:
        verbose_name = "intervención"
        verbose_name_plural = "intervenciones"
        ordering = ("created_at", "id")
        indexes = [
            models.Index(fields=("incident", "created_at"), name="intervention_incident_idx")
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(result__in=["solved", "in_progress", "not_solved"]),
                name="intervention_result_valid",
            ),
            models.CheckConstraint(
                condition=~Q(diagnosis="") & ~Q(actions_taken=""),
                name="intervention_required_texts",
            ),
            models.CheckConstraint(
                condition=Q(used_parts=False, used_parts_detail="")
                | (Q(used_parts=True) & ~Q(used_parts_detail="")),
                name="intervention_used_parts_detail",
            ),
            models.CheckConstraint(
                condition=Q(parts_required=False, parts_required_detail="")
                | (Q(parts_required=True) & ~Q(parts_required_detail="")),
                name="intervention_required_parts_detail",
            ),
            models.CheckConstraint(
                condition=Q(result="solved", unresolved_reason="")
                | (~Q(result="solved") & ~Q(unresolved_reason="")),
                name="intervention_reason_when_unresolved",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.incident} · {self.get_result_display()}"


class IncidentVerification(models.Model):
    """
    Verificación del Planificador sobre un cierre técnico (ADR 0006). Una por cierre:
    las verificaciones anteriores nunca se sobrescriben.
    """

    class Result(models.TextChoices):
        CONFORMING = "conforming", "Conforme"
        NOT_CONFORMING = "not_conforming", "No conforme"

    incident = models.ForeignKey(Incident, on_delete=models.PROTECT, related_name="verifications")
    closing_intervention = models.OneToOneField(
        IncidentIntervention,
        on_delete=models.PROTECT,
        related_name="verification",
        verbose_name="cierre verificado",
    )
    result = models.CharField("resultado", max_length=20, choices=Result.choices)
    observations = models.TextField("observaciones", blank=True)
    verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        verbose_name="verificada por",
    )
    created_at = models.DateTimeField("verificada", auto_now_add=True)

    class Meta:
        verbose_name = "verificación"
        verbose_name_plural = "verificaciones"
        ordering = ("created_at", "id")
        constraints = [
            models.CheckConstraint(
                condition=Q(result__in=["conforming", "not_conforming"]),
                name="verification_result_valid",
            ),
            models.CheckConstraint(
                condition=Q(result="conforming") | ~Q(observations=""),
                name="verification_observations_when_not_conforming",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.incident} · {self.get_result_display()}"
