from django.urls import path, re_path

from .views import (
    AttentionListView,
    HomeSummaryView,
    IncidentAttachmentView,
    IncidentDetailView,
    IncidentInterventionView,
    IncidentListCreateView,
    IncidentOptionsView,
    IncidentPlanningView,
    IncidentPriorityView,
    IncidentReopenView,
    IncidentSurveyView,
    IncidentTechniciansView,
    IncidentVerificationView,
    PlanningListView,
    PlanningOptionsView,
    SurveyReminderView,
)

app_name = "incidents"

CODE = r"(?P<code>[A-Za-z0-9-]{3,20})"

# Las rutas fijas (options, planning) van antes que las rutas con código.
urlpatterns = [
    path("incidents/", IncidentListCreateView.as_view(), name="list"),
    path("incidents/options/", IncidentOptionsView.as_view(), name="options"),
    path("incidents/summary/", HomeSummaryView.as_view(), name="summary"),
    path("incidents/survey-reminder/", SurveyReminderView.as_view(), name="survey-reminder"),
    path("incidents/planning/", PlanningListView.as_view(), name="planning-list"),
    path("incidents/planning/options/", PlanningOptionsView.as_view(), name="planning-options"),
    path("incidents/attention/", AttentionListView.as_view(), name="attention-list"),
    re_path(rf"^incidents/{CODE}/$", IncidentDetailView.as_view(), name="detail"),
    re_path(
        rf"^incidents/{CODE}/attachments/(?P<pk>[0-9]+)/$",
        IncidentAttachmentView.as_view(),
        name="attachment",
    ),
    re_path(
        rf"^incidents/{CODE}/technicians/$",
        IncidentTechniciansView.as_view(),
        name="technicians",
    ),
    re_path(rf"^incidents/{CODE}/priority/$", IncidentPriorityView.as_view(), name="priority"),
    re_path(rf"^incidents/{CODE}/planning/$", IncidentPlanningView.as_view(), name="planning"),
    re_path(
        rf"^incidents/{CODE}/interventions/$",
        IncidentInterventionView.as_view(),
        name="interventions",
    ),
    re_path(
        rf"^incidents/{CODE}/verification/$",
        IncidentVerificationView.as_view(),
        name="verification",
    ),
    re_path(rf"^incidents/{CODE}/reopen/$", IncidentReopenView.as_view(), name="reopen"),
    re_path(rf"^incidents/{CODE}/survey/$", IncidentSurveyView.as_view(), name="survey"),
]
