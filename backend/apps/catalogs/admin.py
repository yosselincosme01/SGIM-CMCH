from django.contrib import admin

from .models import CareUnit


@admin.register(CareUnit)
class CareUnitAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "is_active", "is_demo")
    list_filter = ("is_active", "is_demo")
    search_fields = ("name", "code")
    prepopulated_fields = {"code": ("name",)}
