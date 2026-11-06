from rest_framework import exceptions
from rest_framework.views import exception_handler

SESSION_EXPIRED_MESSAGE = "La sesión ha expirado. Inicia sesión nuevamente."


def api_exception_handler(exc, context):
    """
    Manejador de errores de la API.

    Añade ``code`` a las respuestas 401 para que el frontend distinga una sesión
    vencida (``session_expired``, con su ``reason``) de una petición sin sesión
    (``not_authenticated``).
    """
    response = exception_handler(exc, context)
    if response is None or not isinstance(exc, exceptions.NotAuthenticated):
        return response

    request = context.get("request")
    reason = getattr(getattr(request, "_request", request), "session_expired_reason", None)
    if reason:
        response.data = {
            "detail": SESSION_EXPIRED_MESSAGE,
            "code": "session_expired",
            "reason": str(reason),
        }
    else:
        response.data = {"detail": response.data.get("detail"), "code": "not_authenticated"}
    return response
