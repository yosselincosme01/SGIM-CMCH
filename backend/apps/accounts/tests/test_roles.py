import importlib

import pytest
from django.contrib.auth.models import AnonymousUser, Group

from apps.accounts.roles import Role, get_roles, has_role

role_migration = importlib.import_module("apps.accounts.migrations.0002_create_role_groups")


def test_initial_roles():
    assert set(Role.values) == {"administrador", "solicitante", "planificador", "personal_atencion"}


def test_migration_creates_exactly_the_defined_roles():
    assert set(role_migration.ROLE_NAMES) == set(Role.values)


def test_anonymous_user_has_no_roles():
    anonymous = AnonymousUser()

    assert get_roles(anonymous) == []
    assert has_role(anonymous, Role.ADMINISTRADOR) is False


@pytest.mark.django_db
def test_role_groups_exist_after_migrations():
    assert set(Group.objects.values_list("name", flat=True)) >= set(Role.values)


@pytest.mark.django_db
def test_user_can_have_several_roles(make_user):
    user = make_user(roles=[Role.PLANIFICADOR, Role.PERSONAL_ATENCION])

    assert get_roles(user) == ["personal_atencion", "planificador"]
    assert has_role(user, Role.PERSONAL_ATENCION)
    assert has_role(user, [Role.ADMINISTRADOR, Role.PLANIFICADOR])
    assert not has_role(user, Role.ADMINISTRADOR)


@pytest.mark.django_db
def test_user_without_roles(make_user):
    user = make_user()

    assert get_roles(user) == []
    assert not has_role(user, Role.SOLICITANTE)


@pytest.mark.django_db
def test_non_role_groups_are_ignored(make_user):
    user = make_user()
    user.groups.add(Group.objects.create(name="otro-grupo"))

    assert get_roles(user) == []


@pytest.mark.django_db
def test_inactive_user_has_no_roles(make_user):
    user = make_user(roles=[Role.ADMINISTRADOR], is_active=False)

    assert get_roles(user) == []
    assert not has_role(user, Role.ADMINISTRADOR)


@pytest.mark.django_db
def test_superuser_does_not_get_functional_roles_automatically(make_user):
    """Sin acceso global automático: el superusuario necesita roles explícitos."""
    user = make_user(is_superuser=True, is_staff=True)

    assert get_roles(user) == []
    for role in Role:
        assert not has_role(user, role)


@pytest.mark.django_db
def test_superuser_with_explicit_role_has_only_that_role(make_user):
    user = make_user(roles=[Role.SOLICITANTE], is_superuser=True, is_staff=True)

    assert has_role(user, Role.SOLICITANTE)
    assert not has_role(user, Role.PLANIFICADOR)


@pytest.mark.django_db
def test_role_groups_have_no_permissions_by_default():
    """Mínimo privilegio: los permisos se asignarán con el módulo de incidencias."""
    groups = Group.objects.filter(name__in=Role.values)

    assert groups.count() == len(Role.values)
    for group in groups:
        assert group.permissions.count() == 0


@pytest.mark.django_db
def test_all_four_roles_can_be_combined(make_user):
    user = make_user(roles=list(Role))

    assert get_roles(user) == sorted(Role.values)
