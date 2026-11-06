from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver

from . import session_policy


@receiver(user_logged_in, dispatch_uid="sgim_session_policy_start")
def start_session_policy(sender, request, user, **kwargs):
    """Cada inicio de sesión (API o admin) fija un nuevo límite absoluto."""
    if request is not None and hasattr(request, "session"):
        session_policy.start(request.session)
