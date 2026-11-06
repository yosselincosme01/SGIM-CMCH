from rest_framework.authentication import SessionAuthentication as DRFSessionAuthentication


class SessionAuthentication(DRFSessionAuthentication):
    """
    Autenticación por sesión de Django que responde 401 (no 403) sin sesión.

    DRF solo devuelve 401 si la clase de autenticación define una cabecera
    WWW-Authenticate. Así el frontend distingue "sin sesión" (401) de
    "sin permiso" (403).
    """

    def authenticate_header(self, request) -> str:
        return 'Session realm="api"'
