from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import generics, serializers, status
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdministrador
from apps.accounts.roles import Role
from apps.incidents.models import Incident

from . import incidents, metrics, reports, user_services
from .models import AuditLog
from .serializers import (
    ActivationSerializer,
    AdminUserSerializer,
    AuditLogSerializer,
    PasswordResetSerializer,
    UserCreateSerializer,
    UserUpdateSerializer,
    admin_options,
)


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "El cambio no se puede aplicar en el estado actual."
    default_code = "conflict"


def run(action, **kwargs):
    """Traduce las excepciones de los servicios a respuestas HTTP."""
    try:
        return action(**kwargs)
    except user_services.AdminConflict as exc:
        raise Conflict(str(exc)) from exc
    except DjangoPermissionDenied as exc:
        raise PermissionDenied(str(exc)) from exc
    except DjangoValidationError as exc:
        detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
        raise serializers.ValidationError(detail) from exc


# --- Gestión de usuarios (solo Administrador) ----------------------------------------


class AdminOptionsView(APIView):
    permission_classes = [IsAuthenticated, IsAdministrador]

    def get(self, request: Request) -> Response:
        return Response(admin_options())


class AdminUserListCreateView(generics.ListAPIView):
    """
    GET  /admin/users/?q=&role=&active=true|false&area=   Búsqueda y filtros, paginada.
    POST /admin/users/                                    Alta de una cuenta operativa.
    """

    serializer_class = AdminUserSerializer
    permission_classes = [IsAuthenticated, IsAdministrador]

    def get_queryset(self):
        params = self.request.query_params
        queryset = get_user_model().objects.order_by("username")
        if text := params.get("q", "").strip()[:100]:
            queryset = queryset.filter(
                Q(username__icontains=text)
                | Q(first_name__icontains=text)
                | Q(last_name__icontains=text)
                | Q(email__icontains=text)
            )
        if role := params.get("role"):
            if role not in Role.values:
                raise serializers.ValidationError({"role": "Rol no válido."})
            queryset = queryset.filter(groups__name=role)
        if (active := params.get("active")) in ("true", "false"):
            queryset = queryset.filter(is_active=active == "true")
        if area := params.get("area"):
            queryset = queryset.filter(area_memberships__area__code=area)
        return queryset.distinct()

    def post(self, request: Request) -> Response:
        serializer = UserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = run(
            user_services.create_operational_user, actor=request.user, **serializer.validated_data
        )
        return Response(AdminUserSerializer(user).data, status=status.HTTP_201_CREATED)


class _AdminUserMixin:
    permission_classes = [IsAuthenticated, IsAdministrador]

    def get_user(self, pk: int):
        return get_object_or_404(get_user_model(), pk=pk)


class AdminUserDetailView(_AdminUserMixin, APIView):
    def get(self, request: Request, pk: int) -> Response:
        return Response(AdminUserSerializer(self.get_user(pk)).data)

    def patch(self, request: Request, pk: int) -> Response:
        user = self.get_user(pk)
        serializer = UserUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = run(
            user_services.update_operational_user,
            actor=request.user,
            user=user,
            **serializer.validated_data,
        )
        user.refresh_from_db()
        return Response(AdminUserSerializer(user).data)


class AdminUserActivationView(_AdminUserMixin, APIView):
    def post(self, request: Request, pk: int) -> Response:
        user = self.get_user(pk)
        serializer = ActivationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = run(
            user_services.set_user_active,
            actor=request.user,
            user=user,
            active=serializer.validated_data["active"],
        )
        return Response(AdminUserSerializer(user).data)


class AdminUserPasswordView(_AdminUserMixin, APIView):
    def post(self, request: Request, pk: int) -> Response:
        user = self.get_user(pk)
        serializer = PasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        run(
            user_services.reset_user_password,
            actor=request.user,
            user=user,
            new_password=serializer.validated_data["password"],
        )
        # No se devuelve la contraseña ni ningún dato sensible.
        return Response(status=status.HTTP_204_NO_CONTENT)


class AuditLogListView(generics.ListAPIView):
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated, IsAdministrador]

    def get_queryset(self):
        queryset = AuditLog.objects.select_related("actor", "target_user")
        if action := self.request.query_params.get("action"):
            queryset = queryset.filter(action=action)
        if target := self.request.query_params.get("user"):
            queryset = (
                queryset.filter(target_user_id=target) if target.isdigit() else queryset.none()
            )
        return queryset


# --- Consulta global de incidencias (solo lectura, ADR 0009) --------------------------


class AdminIncidentListView(generics.ListAPIView):
    """
    Todas las incidencias, de solo lectura. Filtros: ``area``, ``status``,
    ``priority`` (``none`` = sin prioridad), ``q`` (código o descripción) y
    ``date_from``/``date_to`` (fecha de registro, AAAA-MM-DD, hora de Lima; opcionales).
    """

    serializer_class = incidents.AdminIncidentListSerializer
    permission_classes = [IsAuthenticated, IsAdministrador]

    def get_queryset(self):
        params = self.request.query_params
        queryset = incidents.global_incidents()
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
        if text := params.get("q", "").strip()[:100]:
            queryset = queryset.filter(Q(code__icontains=text) | Q(description__icontains=text))
        start, end = incidents.registration_range(params)
        if start:
            queryset = queryset.filter(created_at__gte=start)
        if end:
            queryset = queryset.filter(created_at__lt=end)
        return queryset.order_by("-created_at", "-id")


class AdminIncidentDetailView(APIView):
    """Detalle de solo lectura, sin evidencia descargable ni acciones."""

    permission_classes = [IsAuthenticated, IsAdministrador]

    def get(self, request: Request, code: str) -> Response:
        incident = get_object_or_404(incidents.global_detail_queryset(), code=code.strip().upper())
        serializer = incidents.AdminIncidentDetailSerializer(incident, context={"request": request})
        return Response(serializer.data)


# --- Indicadores y reportes (Administrador: global; Planificador: sus áreas) ---------


def _scope(request):
    try:
        return metrics.scope_for(request.user)
    except DjangoPermissionDenied as exc:
        raise PermissionDenied(str(exc)) from exc


def _incidents(request, scope):
    try:
        filters = metrics.parse_filters(request.query_params)
        return filters, metrics.scoped_incidents(scope, filters)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(exc.message_dict) from exc
    except DjangoPermissionDenied as exc:
        raise PermissionDenied(str(exc)) from exc


class ReportOptionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        scope = _scope(request)
        return Response(
            {
                "scope": scope.kind,
                "areas": [
                    {"code": area.code, "name": area.name} for area in scope.areas.order_by("name")
                ],
                "reports": [
                    {"code": code, "label": label} for code, (label, _) in reports.REPORTS.items()
                ],
                "max_rows": reports.MAX_ROWS,
                "max_range_days": metrics.MAX_RANGE_DAYS,
            }
        )


class DashboardView(APIView):
    """Indicadores dentro del alcance del usuario (global o áreas autorizadas)."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        scope = _scope(request)
        filters, incidents = _incidents(request, scope)
        return Response(
            {
                "scope": scope.kind,
                "filters": filters.as_dict(),
                **metrics.compute_dashboard(incidents),
            }
        )


class ReportExportView(APIView):
    """Descarga .xlsx de un reporte, auditada. Solo GET: no modifica datos."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request, slug: str) -> HttpResponse:
        if slug not in reports.REPORTS:
            return Response({"detail": "Reporte no encontrado."}, status=status.HTTP_404_NOT_FOUND)
        scope = _scope(request)
        filters, incidents = _incidents(request, scope)
        label = "todas las áreas" if scope.kind == "global" else "áreas autorizadas"
        try:
            content, rows = reports.build_report(slug, incidents, filters, label)
        except reports.ReportTooLarge as exc:
            raise serializers.ValidationError({"detail": str(exc)}) from exc
        user_services.record_export(
            actor=request.user, report=slug, scope=scope.kind, filters=filters.as_dict(), rows=rows
        )
        response = HttpResponse(
            content,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = (
            f'attachment; filename="{reports.report_filename(slug, filters)}"'
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
