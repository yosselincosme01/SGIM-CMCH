from django.contrib.auth import authenticate
from rest_framework import serializers

from .models import User
from .roles import get_roles

INVALID_CREDENTIALS = "Usuario o contraseña incorrectos."


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150, trim_whitespace=True)
    password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)

    def validate(self, attrs):
        user = authenticate(
            request=self.context.get("request"),
            username=attrs["username"],
            password=attrs["password"],
        )
        # Mismo mensaje para usuario inexistente, contraseña incorrecta o cuenta
        # inactiva: no se revela qué usuarios existen.
        if user is None or not user.is_active:
            raise serializers.ValidationError(INVALID_CREDENTIALS, code="invalid_credentials")
        attrs["user"] = user
        return attrs


class CurrentUserSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    roles = serializers.SerializerMethodField()
    capabilities = serializers.SerializerMethodField()
    area_functions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "email",
            "roles",
            "capabilities",
            "area_functions",
        )
        read_only_fields = fields

    def get_roles(self, user) -> list[str]:
        return get_roles(user)

    def get_capabilities(self, user) -> dict[str, bool]:
        """
        Funciones efectivas por área (ADR 0008), solo para adaptar la interfaz. El
        backend vuelve a validar cada acción con el área concreta.
        """
        from apps.incidents.selectors import effective_capabilities

        return effective_capabilities(user)

    def get_area_functions(self, user) -> list[dict]:
        """Funciones efectivas por área (ADR 0009). Solo para mostrar y navegar."""
        from apps.incidents.selectors import effective_area_functions

        return effective_area_functions(user)
