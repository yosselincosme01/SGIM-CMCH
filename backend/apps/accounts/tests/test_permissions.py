import pytest
from django.contrib.auth.models import AnonymousUser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from apps.accounts.permissions import HasAnyRole, IsPlanificador, require_roles
from apps.accounts.roles import Role


def _view_with(permission_class):
    class DummyView(APIView):
        permission_classes = [permission_class]

        def get(self, request):
            return Response({"ok": True})

    return DummyView.as_view()


def _get(view, user):
    request = APIRequestFactory().get("/dummy/")
    force_authenticate(request, user=user)
    return view(request)


def test_require_roles_needs_at_least_one_role():
    with pytest.raises(ValueError):
        require_roles()


def test_require_roles_builds_permission_class():
    permission = require_roles(Role.PLANIFICADOR, Role.ADMINISTRADOR)

    assert issubclass(permission, HasAnyRole)
    assert permission.required_roles == (Role.PLANIFICADOR, Role.ADMINISTRADOR)


def test_permission_without_roles_denies_everyone():
    assert HasAnyRole().has_permission(None, None) is False


def test_anonymous_is_rejected():
    response = _get(_view_with(IsPlanificador), AnonymousUser())

    assert response.status_code in (401, 403)


@pytest.mark.django_db
def test_user_with_required_role_is_allowed(make_user):
    response = _get(_view_with(IsPlanificador), make_user(roles=[Role.PLANIFICADOR]))

    assert response.status_code == 200


@pytest.mark.django_db
def test_user_with_any_of_the_roles_is_allowed(make_user):
    permission = require_roles(Role.PLANIFICADOR, Role.ADMINISTRADOR)

    response = _get(_view_with(permission), make_user(roles=[Role.ADMINISTRADOR]))

    assert response.status_code == 200


@pytest.mark.django_db
def test_user_without_required_role_is_forbidden(make_user):
    response = _get(_view_with(IsPlanificador), make_user(roles=[Role.SOLICITANTE]))

    assert response.status_code == 403


def test_allow_any_sanity_check():
    """Control: la vista auxiliar responde cuando el permiso lo permite."""
    response = _get(_view_with(AllowAny), AnonymousUser())

    assert response.status_code == 200
