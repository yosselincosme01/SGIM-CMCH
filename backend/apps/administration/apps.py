from django.apps import AppConfig


class AdministrationConfig(AppConfig):
    """Administración operativa, indicadores, reportes y auditoría (ADR 0007)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.administration"
    verbose_name = "Administración"
