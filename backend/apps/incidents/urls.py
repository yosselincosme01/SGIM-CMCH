from django.urls import path, re_path

from .views import (
    IncidentAttachmentView,
    IncidentDetailView,
    IncidentListCreateView,
    IncidentOptionsView,
)

app_name = "incidents"

CODE = r"(?P<code>[A-Za-z0-9-]{3,20})"

urlpatterns = [
    path("incidents/", IncidentListCreateView.as_view(), name="list"),
    path("incidents/options/", IncidentOptionsView.as_view(), name="options"),
    re_path(rf"^incidents/{CODE}/$", IncidentDetailView.as_view(), name="detail"),
    re_path(
        rf"^incidents/{CODE}/attachments/(?P<pk>[0-9]+)/$",
        IncidentAttachmentView.as_view(),
        name="attachment",
    ),
]
