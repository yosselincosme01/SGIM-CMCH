from rest_framework import serializers

from apps.accounts.roles import Role, get_roles
from apps.incidents.models import SupportArea, SupportAreaMembership

from .models import AuditLog
from .user_services import MANAGED_ROLES, is_protected_account, open_assignment_areas

ROLE_LABELS = dict(Role.choices) | {
    Role.PLANIFICADOR: "Planificador",
    Role.PERSONAL_ATENCION: "Personal de Atención",
}


class AdminUserSerializer(serializers.Serializer):
    """Cuenta vista por el Administrador. Nunca incluye la contraseña ni su hash."""

    id = serializers.IntegerField()
    username = serializers.CharField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    full_name = serializers.CharField()
    email = serializers.CharField()
    is_active = serializers.BooleanField()
    last_login = serializers.DateTimeField(allow_null=True)
    date_joined = serializers.DateTimeField()
    roles = serializers.SerializerMethodField()
    memberships = serializers.SerializerMethodField()
    is_protected = serializers.SerializerMethodField()
    open_assignment_areas = serializers.SerializerMethodField()

    def get_roles(self, user) -> list[str]:
        return get_roles(user)

    def get_memberships(self, user) -> list[dict]:
        return [
            {
                "area": m.area.code,
                "area_name": m.area.name,
                "can_plan": m.can_plan,
                "can_be_assigned": m.can_be_assigned,
            }
            for m in SupportAreaMembership.objects.filter(user=user)
            .select_related("area")
            .order_by("area__name")
        ]

    def get_is_protected(self, user) -> bool:
        return is_protected_account(user)

    def get_open_assignment_areas(self, user) -> list[str]:
        return sorted(open_assignment_areas(user))


class _StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        unexpected = sorted(set(getattr(data, "keys", dict)()) - set(self.fields))
        if unexpected:
            raise serializers.ValidationError(
                {name: ["Este campo no está permitido."] for name in unexpected}
            )
        return super().to_internal_value(data)


class MembershipInputSerializer(_StrictSerializer):
    area = serializers.CharField(max_length=40)
    can_plan = serializers.BooleanField(default=False)
    can_be_assigned = serializers.BooleanField(default=False)


def _roles_field(**kwargs):
    return serializers.ListField(
        child=serializers.CharField(max_length=40), allow_empty=True, **kwargs
    )


class UserCreateSerializer(_StrictSerializer):
    username = serializers.CharField(max_length=150)
    first_name = serializers.CharField(max_length=150, allow_blank=True)
    last_name = serializers.CharField(max_length=150, allow_blank=True)
    email = serializers.EmailField(allow_blank=True, required=False, default="")
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    password_confirm = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    roles = _roles_field()
    memberships = MembershipInputSerializer(many=True, required=False, default=list)

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("password_confirm"):
            raise serializers.ValidationError({"password_confirm": "Las contraseñas no coinciden."})
        return attrs


class UserUpdateSerializer(_StrictSerializer):
    """
    Campos editables. ``is_superuser``, ``is_staff``, ``username``, ``password`` y
    cualquier otro campo se rechazan (400), aunque se envíen directamente a la API.
    """

    first_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    last_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    email = serializers.EmailField(allow_blank=True, required=False)
    roles = _roles_field(required=False)
    memberships = MembershipInputSerializer(many=True, required=False)


class ActivationSerializer(_StrictSerializer):
    active = serializers.BooleanField()


class PasswordResetSerializer(_StrictSerializer):
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    password_confirm = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        if attrs["password"] != attrs["password_confirm"]:
            raise serializers.ValidationError({"password_confirm": "Las contraseñas no coinciden."})
        return attrs


class AuditLogSerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source="get_action_display")
    actor = serializers.SerializerMethodField()
    target_user = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ("id", "action", "action_label", "actor", "target_user", "details", "created_at")
        read_only_fields = fields

    def get_actor(self, log) -> str:
        return log.actor.username if log.actor else "Procedimiento técnico (TI)"

    def get_target_user(self, log) -> str | None:
        return log.target_user.username if log.target_user else None


def admin_options() -> dict:
    return {
        "roles": [{"code": role, "label": ROLE_LABELS[role]} for role in MANAGED_ROLES],
        "areas": [
            {"code": area.code, "name": area.name}
            for area in SupportArea.objects.filter(is_active=True).order_by("name")
        ],
    }
