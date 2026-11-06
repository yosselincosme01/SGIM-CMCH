import pytest
from django.core.management import call_command

from apps.catalogs.management.commands.seed_demo_care_units import DEMO_CARE_UNITS
from apps.catalogs.models import CareUnit


def test_demo_names_are_clearly_marked():
    assert all(name.startswith("[DEMO] ") for _, name in DEMO_CARE_UNITS)
    assert all(code.startswith("demo-") for code, _ in DEMO_CARE_UNITS)


@pytest.mark.django_db
def test_seed_demo_care_units_is_idempotent():
    call_command("seed_demo_care_units", verbosity=0)
    call_command("seed_demo_care_units", verbosity=0)

    assert CareUnit.objects.count() == len(DEMO_CARE_UNITS)
    assert not CareUnit.objects.filter(is_demo=False).exists()


@pytest.mark.django_db
def test_migrations_do_not_load_demo_units():
    """El catálogo de demostración solo se carga con el comando explícito."""
    assert CareUnit.objects.count() == 0
