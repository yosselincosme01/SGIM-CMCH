import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.db import IntegrityError, transaction

from apps.accounts.models import User

from .conftest import TEST_PASSWORD


def test_auth_user_model_is_custom():
    assert settings.AUTH_USER_MODEL == "accounts.User"
    assert get_user_model() is User


def test_user_table_is_not_legacy_auth_user():
    assert User._meta.db_table == "accounts_user"


@pytest.mark.django_db
def test_create_user_hashes_password(make_user):
    user = make_user()

    assert user.pk is not None
    assert user.is_active
    assert not user.is_staff
    assert not user.is_superuser
    assert user.password != TEST_PASSWORD
    assert user.check_password(TEST_PASSWORD)


@pytest.mark.django_db
def test_create_superuser():
    admin = User.objects.create_superuser("soporte.prueba", "soporte@example.test", "x" * 12)

    assert admin.is_staff
    assert admin.is_superuser


@pytest.mark.django_db
def test_full_name_falls_back_to_username(make_user):
    assert make_user(first_name="Ana", last_name="Prueba").full_name == "Ana Prueba"
    assert make_user(username="sin.nombre").full_name == "sin.nombre"


@pytest.mark.django_db
def test_no_missing_migrations():
    call_command("makemigrations", "--check", "--dry-run", verbosity=0)


# --- Cuentas individuales -------------------------------------------------


def test_username_is_unique():
    assert User._meta.get_field("username").unique


@pytest.mark.django_db
def test_username_is_unique_ignoring_case(make_user):
    make_user(username="ana.prueba")

    with pytest.raises(IntegrityError), transaction.atomic():
        make_user(username="Ana.Prueba")


@pytest.mark.django_db
def test_each_person_has_an_individual_account(make_user):
    first = make_user(username="ana.prueba")
    second = make_user(username="luis.prueba")

    assert first.pk != second.pk
    assert first.password != second.password  # cada hash lleva su propia sal


# --- Sin vínculo obligatorio con UPS o servicio --------------------------

UNIT_HINTS = ("ups", "servicio", "unidad", "area", "sede")


def test_user_has_no_unit_fields():
    words = {word for field in User._meta.get_fields() for word in field.name.lower().split("_")}

    assert words.isdisjoint(UNIT_HINTS)


def test_user_has_no_mandatory_relations():
    """Las únicas relaciones del usuario son las de Django (grupos y permisos)."""
    relations = {
        field.name
        for field in User._meta.get_fields()
        if field.is_relation and not field.auto_created and field.concrete
    }

    assert relations <= {"groups", "user_permissions"}
    for name in relations:
        assert User._meta.get_field(name).blank


def test_only_username_and_password_are_required_to_create_a_user():
    assert User.REQUIRED_FIELDS == ["email"]  # solo lo pide createsuperuser
    assert User._meta.get_field("email").blank


@pytest.mark.django_db
def test_user_can_be_created_without_unit_or_email():
    user = User.objects.create_user(username="sin.unidad", password=TEST_PASSWORD)

    assert user.pk is not None
    assert user.email == ""
