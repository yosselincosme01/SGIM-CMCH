from datetime import UTC, datetime

from django.contrib.auth import login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import session_policy
from .authentication import SessionAuthentication
from .serializers import CurrentUserSerializer, LoginSerializer


def _iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=UTC).isoformat()


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Entrega la cookie ``csrftoken`` que el frontend debe reenviar en ``X-CSRFToken``."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        return Response(status=status.HTTP_204_NO_CONTENT)


class LoginView(APIView):
    """Inicia sesión con usuario y contraseña. Exige CSRF y limita los intentos."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request: Request) -> Response:
        # DRF solo comprueba CSRF a usuarios autenticados; el login es anónimo,
        # así que se comprueba explícitamente (respuesta 403 si falta el token).
        SessionAuthentication().enforce_csrf(request)

        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]

        # login() rota el identificador de sesión (evita la fijación de sesión).
        login(request, user)
        return Response(CurrentUserSerializer(user).data, status=status.HTTP_200_OK)


class LogoutView(APIView):
    """Cierra la sesión actual. Exige sesión activa y CSRF."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    """Datos y roles del usuario autenticado."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(CurrentUserSerializer(request.user).data)


class SessionStatusView(APIView):
    """
    Estado de la sesión para que el frontend muestre avisos de expiración.

    Es **pasiva**: consultarla no cuenta como actividad, así que el polling no
    prolonga la inactividad. Solo expone tiempos, nunca el identificador de sesión.
    """

    permission_classes = [IsAuthenticated]
    session_passive = True

    def get(self, request: Request) -> Response:
        times = session_policy.get_times(request.session)
        if times is None:  # no debería ocurrir: el middleware invalida estas sesiones
            logout(request)
            return Response(
                {"detail": "Sesión no válida.", "code": "session_expired", "reason": "invalid"},
                status=status.HTTP_401_UNAUTHORIZED,
            )
        current = session_policy.now()
        return Response(
            {
                "server_time": _iso(current),
                "expires_at": _iso(times.expires_at),
                "expires_in": max(0, int(times.expires_at - current)),
                "absolute_expires_at": _iso(times.absolute_expires_at),
                "idle_expires_at": _iso(times.idle_expires_at),
                "absolute_timeout": session_policy.absolute_timeout(),
                "idle_timeout": session_policy.idle_timeout(),
            }
        )
