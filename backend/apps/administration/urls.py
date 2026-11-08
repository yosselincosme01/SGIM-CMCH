from django.urls import path, re_path

from .views import (
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
    path("reports/options/", ReportOptionsView.as_view(), name="report-options"),
    path("reports/dashboard/", DashboardView.as_view(), name="dashboard"),
    re_path(r"^reports/(?P<slug>[a-z]{3,20})/export/$", ReportExportView.as_view(), name="export"),
]
