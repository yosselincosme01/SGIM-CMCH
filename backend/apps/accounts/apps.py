from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = "apps.accounts"
    verbose_name = "Cuentas y roles"

    def ready(self) -> None:
        from . import signals  # noqa: F401  registra los receptores de señales
