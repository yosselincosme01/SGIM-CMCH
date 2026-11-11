"""Auditoría de la administración y de las exportaciones (ADR 0007)."""

from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """
    Registro de auditoría de solo adición. No guarda contraseñas ni secretos: solo
    quién hizo qué, cuándo, sobre qué cuenta y los cambios relevantes.
    """

    class Action(models.TextChoices):
        USER_CREATED = "user_created", "Cuenta creada"
        USER_UPDATED = "user_updated", "Datos de la cuenta modificados"
        ROLES_CHANGED = "roles_changed", "Roles modificados"
        MEMBERSHIPS_CHANGED = "memberships_changed", "Autorizaciones por área modificadas"
        USER_ACTIVATED = "user_activated", "Cuenta activada"
        USER_DEACTIVATED = "user_deactivated", "Cuenta desactivada"
        PASSWORD_RESET = "password_reset", "Acceso restablecido (nueva contraseña)"
        ADMIN_CREATED = "admin_created", "Administrador creado por procedimiento técnico"
        REPORT_EXPORTED = "report_exported", "Reporte exportado"

    # Nulo solo para el procedimiento técnico de TI (comando de consola).
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        verbose_name="autor",
    )
    action = models.CharField("acción", max_length=40, choices=Action.choices)
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
        verbose_name="cuenta afectada",
    )
    details = models.JSONField("detalles", default=dict, blank=True)
    created_at = models.DateTimeField("fecha", auto_now_add=True)

    class Meta:
        verbose_name = "registro de auditoría"
        verbose_name_plural = "registros de auditoría"
        ordering = ("-created_at", "-id")
        indexes = [
            models.Index(fields=("action", "-created_at"), name="audit_action_idx"),
            models.Index(fields=("target_user", "-created_at"), name="audit_target_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.get_action_display()} · {self.created_at:%Y-%m-%d %H:%M}"
