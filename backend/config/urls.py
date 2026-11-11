"""Rutas raíz de SGIM-CMCH. La API REST está versionada bajo /api/v1/."""

from django.contrib import admin
from django.urls import include, path

api_v1_patterns = [
    path("", include("apps.core.urls")),
    path("", include("apps.accounts.urls")),
    path("", include("apps.incidents.urls")),
    path("", include("apps.administration.urls")),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include((api_v1_patterns, "api"), namespace="v1")),
]
