from django.contrib import admin

from .models import Incident, IncidentAttachment, IncidentEvent, SupportArea, SupportAreaMembership


class MembershipInline(admin.TabularInline):
    model = SupportAreaMembership
    extra = 0
    autocomplete_fields = ("user",)


@admin.register(SupportArea)
class SupportAreaAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "is_active")
    inlines = (MembershipInline,)

    def has_delete_permission(self, request, obj=None):
        return False  # las áreas tienen incidencias asociadas; se desactivan, no se borran


class AttachmentInline(admin.TabularInline):
    model = IncidentAttachment
    extra = 0
    can_delete = False
    readonly_fields = ("original_name", "content_type", "size", "width", "height", "uploaded_at")
    exclude = ("file", "extension", "uploaded_by")

    def has_add_permission(self, request, obj=None):
        return False


class EventInline(admin.TabularInline):
    model = IncidentEvent
    extra = 0
    can_delete = False
    readonly_fields = ("event_type", "actor", "from_status", "to_status", "details", "created_at")

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    """Consulta para soporte técnico. Las incidencias no se editan desde el admin."""

    list_display = ("code", "status", "care_unit", "support_area", "created_by", "created_at")
    list_filter = ("status", "support_area", "care_unit")
    search_fields = ("code", "description", "asset_reference")
    readonly_fields = (
        "code",
        "status",
        "care_unit",
        "support_area",
        "description",
        "prior_actions",
        "asset_reference",
        "created_by",
        "created_at",
        "updated_at",
    )
    inlines = (AttachmentInline, EventInline)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
