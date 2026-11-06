from django.contrib.auth import logout

from . import session_policy


class SessionPolicyMiddleware:
    """
    Aplica la política de sesión (duración absoluta e inactividad) en cada petición.

    Debe ir después de ``AuthenticationMiddleware``.

    1. Antes de procesar la petición, si la sesión autenticada ha expirado, la
       invalida (``logout``) y continúa como anónima. Las vistas protegidas
       responden entonces 401 con ``code="session_expired"``; las públicas (login,
       csrf, salud) siguen funcionando para poder iniciar sesión de nuevo.
    2. Después de la respuesta, registra actividad válida solo si se resolvió una
       vista, la petición no era pasiva y terminó con éxito (código < 400).
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.session_expired_reason = None
        # Pasiva hasta que se resuelva una vista no pasiva (ver process_view).
        request.session_passive = True

        session = request.session
        if session_policy.is_authenticated_session(session):
            reason = session_policy.expiry_reason(session)
            if reason is not None:
                logout(request)  # vacía la sesión y elimina la cookie en la respuesta
                request.session_expired_reason = reason

        response = self.get_response(request)

        if (
            not request.session_passive
            and request.session_expired_reason is None
            and response.status_code < 400
            and session_policy.is_authenticated_session(request.session)
        ):
            session_policy.touch(request.session)
        return response

    def process_view(self, request, view_func, view_args, view_kwargs):
        request.session_passive = session_policy.is_passive_request(request, view_func)
        return None
