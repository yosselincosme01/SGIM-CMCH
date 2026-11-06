from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    """Administración de usuarios: reutiliza el admin estándar de Django."""

    list_display = ("username", "first_name", "last_name", "email", "is_active", "is_staff")
    list_filter = ("is_active", "is_staff", "is_superuser", "groups")
