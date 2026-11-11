from django.urls import path, re_path

from .views import (
    AdminIncidentDetailView,
    AdminIncidentListView,
    AdminOptionsView,
    AdminUserActivationView,
    AdminUserDetailView,
    AdminUserListCreateView,
    AdminUserPasswordView,
    AuditLogListView,
    DashboardView,
    ReportExportView,
    ReportOptionsView,
)

app_name = "administration"

urlpatterns = [
    path("admin/options/", AdminOptionsView.as_view(), name="options"),
    path("admin/users/", AdminUserListCreateView.as_view(), name="users"),
    path("admin/users/<int:pk>/", AdminUserDetailView.as_view(), name="user-detail"),
    path("admin/users/<int:pk>/activation/", AdminUserActivationView.as_view(), name="activation"),
    path("admin/users/<int:pk>/password/", AdminUserPasswordView.as_view(), name="password"),
    path("admin/audit/", AuditLogListView.as_view(), name="audit"),
    path("admin/incidents/", AdminIncidentListView.as_view(), name="incidents"),
    re_path(
        r"^admin/incidents/(?P<code>[A-Za-z0-9-]{3,20})/$",
        AdminIncidentDetailView.as_view(),
        name="incident-detail",
    ),
    path("reports/options/", ReportOptionsView.as_view(), name="report-options"),
    path("reports/dashboard/", DashboardView.as_view(), name="dashboard"),
    re_path(r"^reports/(?P<slug>[a-z]{3,20})/export/$", ReportExportView.as_view(), name="export"),
]
