"""
Carga UPS/servicios FICTICIOS para desarrollo y demostraciones.

No es el catálogo institucional: todos los nombres llevan el prefijo "[DEMO]" y el
campo ``is_demo=True``. Es idempotente (no duplica ni modifica registros existentes).

Uso:  python manage.py seed_demo_care_units
"""

from django.core.management.base import BaseCommand

from apps.catalogs.models import CareUnit

DEMO_CARE_UNITS = (
    ("demo-emergencia", "[DEMO] Emergencia"),
    ("demo-hospitalizacion", "[DEMO] Hospitalización"),
    ("demo-consulta-externa", "[DEMO] Consulta externa"),
    ("demo-laboratorio", "[DEMO] Laboratorio"),
    ("demo-diagnostico-imagenes", "[DEMO] Diagnóstico por imágenes"),
    ("demo-administracion", "[DEMO] Administración"),
)


class Command(BaseCommand):
    help = "Crea UPS/servicios de demostración (ficticios, marcados con is_demo=True)."

    def handle(self, *args, **options):
        created = 0
        for code, name in DEMO_CARE_UNITS:
            _, was_created = CareUnit.objects.get_or_create(
                code=code, defaults={"name": name, "is_demo": True}
            )
            created += int(was_created)
        self.stdout.write(
            self.style.SUCCESS(
                f"UPS de demostración: {created} creadas, "
                f"{len(DEMO_CARE_UNITS) - created} ya existían."
            )
        )
