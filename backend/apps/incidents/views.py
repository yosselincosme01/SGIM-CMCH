from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsSolicitante
from apps.catalogs.models import CareUnit

from . import selectors, services
from .models import SupportArea
from .serializers import (
    CareUnitOptionSerializer,
    IncidentCreateSerializer,
    IncidentDetailSerializer,
    IncidentListSerializer,
    SupportAreaOptionSerializer,
)


def _normalize_code(code: str) -> str:
    return code.strip().upper()


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
    GET  /incidents/?scope=area   Incidencias de las áreas de soporte del usuario.
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
                raise PermissionDenied("Tu rol no permite consultar las incidencias de un área.")
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
            asset_reference=data.get("asset_reference", ""),
            evidence=data.get("photo"),
        )
        incident = (
            selectors.base_queryset().prefetch_related("attachments", "events").get(pk=incident.pk)
        )
        return Response(IncidentDetailSerializer(incident).data, status=status.HTTP_201_CREATED)


class IncidentDetailView(generics.RetrieveAPIView):
    """Detalle de una incidencia visible para el usuario. Si no lo es, responde 404."""

    serializer_class = IncidentDetailSerializer

    def get_object(self):
        queryset = selectors.visible_incidents(self.request.user).prefetch_related(
            "attachments", "events__actor"
        )
        return get_object_or_404(queryset, code=_normalize_code(self.kwargs["code"]))


class IncidentAttachmentView(APIView):
    """Descarga protegida de una evidencia: solo si el usuario puede ver la incidencia."""

    def get(self, request: Request, code: str, pk: int):
        incident = get_object_or_404(
            selectors.visible_incidents(request.user), code=_normalize_code(code)
        )
        attachment = get_object_or_404(incident.attachments, pk=pk)
        try:
            handle = attachment.file.open("rb")
        except FileNotFoundError as exc:
            raise Http404 from exc
        response = FileResponse(handle, content_type=attachment.content_type)
        response["Content-Disposition"] = f'inline; filename="evidencia.{attachment.extension}"'
        response["Cache-Control"] = "private, no-store"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response
