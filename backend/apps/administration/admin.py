from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    """Auditoría de solo lectura: no se crea, edita ni elimina desde el admin."""

    list_display = ("created_at", "action", "actor", "target_user")
    list_filter = ("action",)
    search_fields = ("actor__username", "target_user__username")
    readonly_fields = ("created_at", "action", "actor", "target_user", "details")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
