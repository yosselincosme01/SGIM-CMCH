from django.contrib import admin

from .models import (
    Incident,
    IncidentAssignment,
    IncidentAttachment,
    IncidentEvent,
    IncidentIntervention,
    IncidentVerification,
    PriorityLevel,
    SupportArea,
    SupportAreaMembership,
)


class MembershipInline(admin.TabularInline):
    """
    Integrantes del área y su función **en esta área**. Ambas casillas empiezan
    desactivadas: habilítalas solo para quien deba planificar o atender en el área.
    Cada función requiere además el rol global correspondiente.
    """

    model = SupportAreaMembership
    extra = 0
    autocomplete_fields = ("user",)
    fields = ("user", "can_plan", "can_be_assigned", "can_verify", "created_at")
    readonly_fields = ("created_at",)


@admin.register(SupportArea)
class SupportAreaAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "is_active")
    inlines = (MembershipInline,)

    def has_delete_permission(self, request, obj=None):
        return False  # las áreas tienen incidencias asociadas; se desactivan, no se borran


@admin.register(SupportAreaMembership)
class SupportAreaMembershipAdmin(admin.ModelAdmin):
    """Vista de control: quién planifica y quién atiende en cada área."""

    list_display = ("user", "area", "can_plan", "can_be_assigned", "can_verify", "created_at")
    list_filter = ("area", "can_plan", "can_be_assigned", "can_verify")
    search_fields = ("user__username", "user__first_name", "user__last_name")
    autocomplete_fields = ("user",)


@admin.register(PriorityLevel)
class PriorityLevelAdmin(admin.ModelAdmin):
    """Catálogo provisional, pendiente de validación institucional."""

    list_display = ("order", "name", "code", "is_active", "is_provisional")
    list_display_links = ("name",)

    def has_delete_permission(self, request, obj=None):
        return False  # se desactivan: pueden estar en uso por incidencias


class AttachmentInline(admin.TabularInline):
    model = IncidentAttachment
    extra = 0
    can_delete = False
    readonly_fields = ("original_name", "content_type", "size", "width", "height", "uploaded_at")
    exclude = ("file", "extension", "uploaded_by")

    def has_add_permission(self, request, obj=None):
        return False


class AssignmentInline(admin.TabularInline):
    model = IncidentAssignment
    extra = 0
    can_delete = False
    fields = (
        "technician",
        "assigned_by",
        "scheduled_at",
        "is_current",
        "reason",
        "created_at",
        "ended_at",
    )
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


class _ReadOnlyInline(admin.TabularInline):
    """Historial técnico: se consulta, pero nunca se crea, edita ni elimina desde el admin."""

    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class InterventionInline(_ReadOnlyInline):
    model = IncidentIntervention
    fields = (
        "created_at",
        "technician",
        "result",
        "diagnosis",
        "actions_taken",
        "used_parts",
        "parts_required",
        "unresolved_reason",
    )
    readonly_fields = fields


class VerificationInline(_ReadOnlyInline):
    model = IncidentVerification
    fields = ("created_at", "verified_by", "result", "observations", "closing_intervention")
    readonly_fields = fields


class EventInline(admin.TabularInline):
    model = IncidentEvent
    extra = 0
    can_delete = False
    readonly_fields = ("event_type", "actor", "from_status", "to_status", "details", "created_at")

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    """
    Consulta para soporte técnico. Las incidencias no se editan ni se planifican desde
    el admin: la planificación pasa por la API para validar permisos y registrar el
    historial.
    """

    list_display = (
        "code",
        "status",
        "priority",
        "care_unit",
        "support_area",
        "created_by",
        "created_at",
    )
    list_filter = ("status", "priority", "support_area", "care_unit")
    search_fields = ("code", "description", "qr_code", "asset_reference")
    readonly_fields = (
        "code",
        "status",
        "priority",
        "care_unit",
        "support_area",
        "description",
        "prior_actions",
        "equipment_qr_status",
        "qr_code",
        "qr_capture_method",
        "asset_reference",
        "closing_intervention",
        "created_by",
        "created_at",
        "updated_at",
    )
    inlines = (
        AttachmentInline,
        AssignmentInline,
        InterventionInline,
        VerificationInline,
        EventInline,
    )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
