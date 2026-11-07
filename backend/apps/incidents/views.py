from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import F, Min, Q
from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, serializers, status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsPersonalAtencion, IsPlanificador, IsSolicitante
from apps.catalogs.models import CareUnit

from . import attention_services, planning_services, selectors, services
from .models import Incident, PriorityLevel, SupportArea
from .serializers import (
    AttentionListSerializer,
    CareUnitOptionSerializer,
    IncidentCreateSerializer,
    IncidentDetailSerializer,
    IncidentListSerializer,
    InterventionInputSerializer,
    PlanningInputSerializer,
    PlanningListSerializer,
    PriorityInputSerializer,
    PriorityLevelSerializer,
    ReopenInputSerializer,
    RequesterIncidentDetailSerializer,
    SupportAreaOptionSerializer,
    TechnicianSerializer,
    VerificationInputSerializer,
    display_time_zone,
)


def _normalize_code(code: str) -> str:
    return code.strip().upper()


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "La incidencia cambió mientras la planificabas."
    default_code = "conflict"


def _detail_queryset(user):
    return (
        selectors.visible_incidents(user)
        .select_related("closing_intervention__technician")
        .prefetch_related(
            "attachments",
            "events__actor",
            "events__incident__support_area",
            "interventions__technician",
            "interventions__photos__incident",
            "interventions__verification__verified_by",
            selectors.current_assignment_prefetch(),
        )
    )


def _detail_response(request: Request, incident: Incident, http_status=status.HTTP_200_OK):
    """
    Serializa el detalle según quién consulta: el personal del área ve los datos de
    planificación; el solicitante, solo el estado y la fecha estimada.
    """
    incident = _detail_queryset(request.user).get(pk=incident.pk)
    if selectors.can_view_as_staff(request.user, incident):
        serializer = IncidentDetailSerializer(incident, context={"request": request})
    else:
        serializer = RequesterIncidentDetailSerializer(incident, context={"request": request})
    return Response(serializer.data, status=http_status)


def _visible_incident_or_404(request: Request, code: str) -> Incident:
    return get_object_or_404(selectors.visible_incidents(request.user), code=_normalize_code(code))


def _to_drf_validation(exc: DjangoValidationError) -> serializers.ValidationError:
    if hasattr(exc, "message_dict"):
        return serializers.ValidationError(exc.message_dict)
    return serializers.ValidationError({"non_field_errors": exc.messages})


# --- Registro y consulta ---------------------------------------------------------


class IncidentOptionsView(APIView):
    """Opciones del formulario de registro: UPS/servicios y áreas de soporte activas."""

    permission_classes = [IsAuthenticated, IsSolicitante]

    def get(self, request: Request) -> Response:
        return Response(
            {
                "care_units": CareUnitOptionSerializer(
                    CareUnit.objects.filter(is_active=True), many=True
                ).data,
                "support_areas": SupportAreaOptionSerializer(
                    SupportArea.objects.filter(is_active=True), many=True
                ).data,
            }
        )


class IncidentListCreateView(generics.ListAPIView):
    """
    GET  /incidents/?scope=mine   Incidencias registradas por el usuario (por defecto).
    GET  /incidents/?scope=area   Incidencias de las áreas donde el usuario tiene una
                                  función autorizada (Planificador o técnico).
    POST /incidents/              Registro (multipart; solo rol solicitante).
    """

    serializer_class = IncidentListSerializer
    parser_classes = [MultiPartParser, JSONParser]

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), IsSolicitante()]
        return [IsAuthenticated()]

    def get_queryset(self):
        scope = self.request.query_params.get("scope", "mine")
        if scope == "mine":
            return selectors.own_incidents(self.request.user)
        if scope == "area":
            if not selectors.can_view_area_inbox(self.request.user):
                raise PermissionDenied("No tienes una función autorizada en ningún área.")
            return selectors.area_incidents(self.request.user)
        raise PermissionDenied("Ámbito de consulta no válido.")

    def post(self, request: Request) -> Response:
        serializer = IncidentCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        incident = services.create_incident(
            user=request.user,
            care_unit=data["care_unit"],
            support_area=data["support_area"],
            description=data["description"],
            prior_actions=data.get("prior_actions", ""),
            equipment_qr_status=data["equipment_qr_status"],
            qr_code=data.get("qr_code", ""),
            qr_capture_method=data.get("qr_capture_method", ""),
            evidence=data.get("photo"),
        )
        return _detail_response(request, incident, status.HTTP_201_CREATED)


class IncidentDetailView(APIView):
    """Detalle de una incidencia visible para el usuario. Si no lo es, responde 404."""

    def get(self, request: Request, code: str) -> Response:
        return _detail_response(request, _visible_incident_or_404(request, code))


class IncidentAttachmentView(APIView):
    """Descarga protegida de una evidencia: solo si el usuario puede ver la incidencia."""

    def get(self, request: Request, code: str, pk: int):
        incident = _visible_incident_or_404(request, code)
        attachment = get_object_or_404(incident.attachments, pk=pk)
        # La evidencia técnica de una intervención solo la ve el personal del área.
        if attachment.intervention_id and not selectors.can_view_as_staff(request.user, incident):
            raise Http404
        try:
            handle = attachment.file.open("rb")
        except FileNotFoundError as exc:
            raise Http404 from exc
        response = FileResponse(handle, content_type=attachment.content_type)
        response["Content-Disposition"] = f'inline; filename="evidencia.{attachment.extension}"'
        response["Cache-Control"] = "private, no-store"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response


# --- Planificación -----------------------------------------------------------------


def _lima_day_range(day: date) -> tuple[datetime, datetime]:
    zone = display_time_zone()
    start = datetime.combine(day, time.min, tzinfo=zone)
    return start, start + timedelta(days=1)


class PlanningOptionsView(APIView):
    """Áreas que el usuario planifica, niveles de prioridad provisionales y contadores."""

    permission_classes = [IsAuthenticated, IsPlanificador]

    def get(self, request: Request) -> Response:
        areas = selectors.planning_areas(request.user).order_by("name")
        inbox = selectors.planning_incidents(request.user)
        today = timezone.localtime(timezone=display_time_zone()).date()
        today_start, today_end = _lima_day_range(today)
        open_inbox = inbox.filter(status__in=selectors.PLANNABLE_STATUSES)
        return Response(
            {
                "areas": SupportAreaOptionSerializer(areas, many=True).data,
                "priorities": PriorityLevelSerializer(
                    PriorityLevel.objects.filter(is_active=True), many=True
                ).data,
                "counts": {
                    "unprioritized": open_inbox.filter(priority__isnull=True).count(),
                    "unassigned": open_inbox.filter(
                        status__in=[Incident.Status.REGISTRADA, Incident.Status.REABIERTA]
                    ).count(),
                    "pending": selectors.pending_queue(
                        inbox.annotate(last_result=selectors.latest_intervention_result_subquery())
                    ).count(),
                    "to_verify": selectors.verification_queue(inbox).count(),
                    "scheduled_today": inbox.filter(
                        assignments__is_current=True,
                        assignments__scheduled_at__gte=today_start,
                        assignments__scheduled_at__lt=today_end,
                    ).count(),
                },
            }
        )


class PlanningListView(generics.ListAPIView):
    """
    Bandeja del Planificador: solo incidencias de sus áreas autorizadas.

    Filtros: ``area``, ``status``, ``priority`` (``none`` = sin prioridad),
    ``technician``, ``scheduled_on`` (AAAA-MM-DD, hora de Lima) y ``q`` (código o
    descripción). Orden (``ordering``): ``priority``, ``created_at``, ``-created_at``
    (por defecto) o ``scheduled_at``.
    """

    serializer_class = PlanningListSerializer
    permission_classes = [IsAuthenticated, IsPlanificador]

    ORDERINGS = {
        "-created_at": ("-created_at", "-id"),
        "created_at": ("created_at", "id"),
        "priority": (F("priority__order").asc(nulls_first=True), "-created_at", "-id"),
        "scheduled_at": (F("current_scheduled_at").asc(nulls_last=True), "-created_at", "-id"),
    }

    def get_queryset(self):
        params = self.request.query_params
        queryset = selectors.planning_incidents(self.request.user).annotate(
            last_result=selectors.latest_intervention_result_subquery()
        )
        # Colas de trabajo del Planificador (ADR 0006).
        queue = params.get("queue", "")
        if queue == "pending":
            queryset = selectors.pending_queue(queryset)
        elif queue == "verification":
            queryset = selectors.verification_queue(queryset)
        elif queue:
            raise serializers.ValidationError({"queue": "Cola no válida."})

        if area := params.get("area"):
            queryset = queryset.filter(support_area__code=area)
        if state := params.get("status"):
            if state not in Incident.Status.values:
                raise serializers.ValidationError({"status": "Estado no válido."})
            queryset = queryset.filter(status=state)
        if priority := params.get("priority"):
            if priority == "none":
                queryset = queryset.filter(priority__isnull=True)
            else:
                queryset = queryset.filter(priority__code=priority)
        if technician := params.get("technician"):
            queryset = queryset.filter(
                assignments__is_current=True, assignments__technician__username=technician
            )
        if scheduled_on := params.get("scheduled_on"):
            try:
                day = date.fromisoformat(scheduled_on)
            except ValueError as exc:
                raise serializers.ValidationError({"scheduled_on": "Fecha no válida."}) from exc
            start, end = _lima_day_range(day)
            queryset = queryset.filter(
                assignments__is_current=True,
                assignments__scheduled_at__gte=start,
                assignments__scheduled_at__lt=end,
            )
        if text := params.get("q", "").strip()[:100]:
            queryset = queryset.filter(Q(code__icontains=text) | Q(description__icontains=text))

        ordering = params.get("ordering", "-created_at")
        if ordering not in self.ORDERINGS:
            raise serializers.ValidationError({"ordering": "Orden no válido."})
        if ordering == "scheduled_at":
            queryset = queryset.annotate(
                current_scheduled_at=Min(
                    "assignments__scheduled_at", filter=Q(assignments__is_current=True)
                )
            )
        return queryset.order_by(*self.ORDERINGS[ordering])


class _PlanningActionView(APIView):
    """Base de las acciones de planificación. El servicio vuelve a validar todo."""

    permission_classes = [IsAuthenticated, IsPlanificador]

    def get_incident(self, request: Request, code: str) -> Incident:
        incident = _visible_incident_or_404(request, code)
        if not selectors.can_plan_area(request.user, incident.support_area):
            raise PermissionDenied(planning_services.NOT_PLANNER)
        return incident

    def run(self, action, **kwargs):
        try:
            return action(**kwargs)
        except planning_services.PlanningConflict as exc:
            raise Conflict(str(exc)) from exc
        except DjangoPermissionDenied as exc:
            raise PermissionDenied(str(exc)) from exc
        except DjangoValidationError as exc:
            raise _to_drf_validation(exc) from exc


class IncidentTechniciansView(_PlanningActionView):
    """Técnicos autorizados del área de la incidencia, con su carga vigente."""

    def get(self, request: Request, code: str) -> Response:
        incident = self.get_incident(request, code)
        technicians = selectors.assignable_technicians(incident.support_area)
        return Response({"results": TechnicianSerializer(technicians, many=True).data})


class IncidentPriorityView(_PlanningActionView):
    """Establece o cambia la prioridad, antes o después de programar la atención."""

    def put(self, request: Request, code: str) -> Response:
        incident = self.get_incident(request, code)
        serializer = PriorityInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.run(
            planning_services.set_priority,
            incident=incident,
            actor=request.user,
            priority=serializer.validated_data["priority"],
            reason=serializer.validated_data["reason"],
        )
        return _detail_response(request, incident)


class IncidentPlanningView(_PlanningActionView):
    """Programa la atención, o la reprograma o reasigna (con motivo obligatorio)."""

    def post(self, request: Request, code: str) -> Response:
        incident = self.get_incident(request, code)
        serializer = PlanningInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        technician = (
            get_user_model()
            .objects.filter(username__iexact=data["technician"], is_active=True)
            .first()
        )
        self.run(
            planning_services.schedule_attention,
            incident=incident,
            actor=request.user,
            priority=data["priority"],
            technician=technician,
            scheduled_at=data["scheduled_at"],
            notes=data["notes"],
            reason=data["reason"],
            expected_assignment_id=data["expected_assignment"],
        )
        return _detail_response(request, incident)


# --- Atención, verificación y reapertura (ADR 0006) ------------------------------


class AttentionListView(generics.ListAPIView):
    """
    Bandeja del Personal de Atención: sus asignaciones vigentes y las que cerró.
    Filtros: ``status`` (asignada o cerrada), ``scheduled_on`` (AAAA-MM-DD, hora de Lima).
    """

    serializer_class = AttentionListSerializer
    permission_classes = [IsAuthenticated, IsPersonalAtencion]

    def get_queryset(self):
        params = self.request.query_params
        queryset = selectors.attention_incidents(self.request.user)
        if state := params.get("status"):
            if state not in (Incident.Status.ASIGNADA, Incident.Status.CERRADA):
                raise serializers.ValidationError({"status": "Estado no válido."})
            queryset = queryset.filter(status=state)
        if scheduled_on := params.get("scheduled_on"):
            try:
                day = date.fromisoformat(scheduled_on)
            except ValueError as exc:
                raise serializers.ValidationError({"scheduled_on": "Fecha no válida."}) from exc
            start, end = _lima_day_range(day)
            queryset = queryset.filter(
                assignments__is_current=True,
                assignments__scheduled_at__gte=start,
                assignments__scheduled_at__lt=end,
            )
        return queryset.annotate(
            current_scheduled_at=Min(
                "assignments__scheduled_at", filter=Q(assignments__is_current=True)
            )
        ).order_by(F("current_scheduled_at").asc(nulls_last=True), "-updated_at", "-id")


class IncidentInterventionView(_PlanningActionView):
    """Registra una intervención del técnico asignado actualmente (multipart, con fotos)."""

    permission_classes = [IsAuthenticated, IsPersonalAtencion]
    parser_classes = [MultiPartParser]

    def get_incident(self, request: Request, code: str) -> Incident:
        # Un ticket que el usuario no ve responde 404; los permisos finos los aplica
        # el servicio (técnico asignado, área autorizada y estado abierto).
        return _visible_incident_or_404(request, code)

    def post(self, request: Request, code: str) -> Response:
        incident = self.get_incident(request, code)
        serializer = InterventionInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        self.run(
            attention_services.register_intervention,
            incident=incident,
            actor=request.user,
            expected_assignment_id=data.pop("assignment"),
            photos=data.pop("photos"),
            **data,
        )
        return _detail_response(request, incident, status.HTTP_201_CREATED)


class IncidentVerificationView(_PlanningActionView):
    """El Planificador del área registra Conforme o No conforme sobre el cierre vigente."""

    def post(self, request: Request, code: str) -> Response:
        incident = self.get_incident(request, code)
        serializer = VerificationInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.run(
            attention_services.verify_closure,
            incident=incident,
            actor=request.user,
            **serializer.validated_data,
        )
        return _detail_response(request, incident)


class IncidentReopenView(_PlanningActionView):
    """Reabre un cierre verificado como No conforme (motivo obligatorio)."""

    def post(self, request: Request, code: str) -> Response:
        incident = self.get_incident(request, code)
        serializer = ReopenInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.run(
            attention_services.reopen_incident,
            incident=incident,
            actor=request.user,
            **serializer.validated_data,
        )
        return _detail_response(request, incident)
