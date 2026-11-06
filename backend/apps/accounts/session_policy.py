"""
Política de sesión del SGIM: dos límites independientes, verificados en el servidor.

- **Duración absoluta** (``SGIM_SESSION_ABSOLUTE_TIMEOUT``, por defecto 8 h): se cuenta
  desde el inicio de sesión y la actividad **no** la amplía.
- **Inactividad** (``SGIM_SESSION_IDLE_TIMEOUT``, por defecto 30 min): se cuenta desde
  la última actividad válida.

La sesión expira al alcanzar cualquiera de los dos límites.

**Actividad válida**: una petición autenticada que no está marcada como pasiva y que
termina con éxito (código HTTP < 400). Son **pasivas**, y por tanto no renuevan la
inactividad:

- las peticiones con la cabecera ``X-SGIM-Passive: 1`` (polling y comprobaciones
  automáticas del frontend);
- las vistas que declaran ``session_passive = True`` (por ejemplo, ``auth/session/``).

``SESSION_COOKIE_AGE`` no es el límite absoluto. Al iniciar sesión, la caducidad de
la cookie y del registro de sesión se fija en el instante absoluto de fin; aun así, la
decisión de expirar se toma siempre aquí, en el servidor.
"""

import time
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum

from django.conf import settings

STARTED_AT_KEY = "_sgim_session_started_at"
LAST_ACTIVITY_KEY = "_sgim_session_last_activity"
PASSIVE_HEADER = "HTTP_X_SGIM_PASSIVE"
AUTH_SESSION_KEY = "_auth_user_id"  # clave que usa django.contrib.auth


class ExpiryReason(StrEnum):
    ABSOLUTE = "absolute"
    IDLE = "idle"
    INVALID = "invalid"  # sesión autenticada sin marcas de tiempo: se rechaza por seguridad


@dataclass(frozen=True)
class SessionTimes:
    started_at: float
    last_activity: float
    absolute_expires_at: float
    idle_expires_at: float

    @property
    def expires_at(self) -> float:
        return min(self.absolute_expires_at, self.idle_expires_at)


def now() -> float:
    """Hora actual en segundos (época Unix). Aislada para poder simularla en pruebas."""
    return time.time()


def absolute_timeout() -> int:
    return settings.SGIM_SESSION_ABSOLUTE_TIMEOUT


def idle_timeout() -> int:
    return settings.SGIM_SESSION_IDLE_TIMEOUT


def is_authenticated_session(session) -> bool:
    return AUTH_SESSION_KEY in session


def start(session, at: float | None = None) -> None:
    """
    Registra el inicio de una sesión autenticada (se llama al iniciar sesión).

    Además fija la caducidad de la cookie y del registro de sesión en el instante
    absoluto de fin, de modo que ninguna actividad posterior la prolonga.
    """
    timestamp = now() if at is None else at
    session[STARTED_AT_KEY] = timestamp
    session[LAST_ACTIVITY_KEY] = timestamp
    session.set_expiry(datetime.fromtimestamp(timestamp + absolute_timeout(), tz=UTC))


def touch(session, at: float | None = None) -> None:
    """Registra actividad válida. Nunca modifica el inicio: no amplía el límite absoluto."""
    session[LAST_ACTIVITY_KEY] = now() if at is None else at


def get_times(session) -> SessionTimes | None:
    started = session.get(STARTED_AT_KEY)
    last = session.get(LAST_ACTIVITY_KEY)
    if not isinstance(started, (int, float)) or not isinstance(last, (int, float)):
        return None
    return SessionTimes(
        started_at=started,
        last_activity=last,
        absolute_expires_at=started + absolute_timeout(),
        idle_expires_at=last + idle_timeout(),
    )


def expiry_reason(session, at: float | None = None) -> ExpiryReason | None:
    """Motivo por el que la sesión ha expirado, o ``None`` si sigue vigente."""
    times = get_times(session)
    if times is None:
        return ExpiryReason.INVALID
    current = now() if at is None else at
    if current >= times.absolute_expires_at:
        return ExpiryReason.ABSOLUTE
    if current >= times.idle_expires_at:
        return ExpiryReason.IDLE
    return None


def is_passive_request(request, view_func=None) -> bool:
    if request.META.get(PASSIVE_HEADER, "").strip().lower() in {"1", "true", "yes"}:
        return True
    view_class = getattr(view_func, "cls", None) or getattr(view_func, "view_class", None)
    return bool(getattr(view_class, "session_passive", False))
