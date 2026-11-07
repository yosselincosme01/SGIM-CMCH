"""
Carga los niveles de prioridad **provisionales**: crítica, alta, media y baja.

No son niveles oficiales de la clínica: quedan marcados con ``is_provisional=True``,
sin descripción ni plazos de atención, hasta que se validen (ADR 0004). Se pueden
ajustar o desactivar desde el admin sin cambiar código.

No modifica pertenencias ni permisos: las funciones por área (``can_plan`` y
``can_be_assigned``) empiezan desactivadas y se habilitan de forma explícita.
"""

from django.db import migrations

PROVISIONAL_LEVELS = (
    ("critica", "Crítica", 1),
    ("alta", "Alta", 2),
    ("media", "Media", 3),
    ("baja", "Baja", 4),
)


def create_levels(apps, schema_editor):
    PriorityLevel = apps.get_model("incidents", "PriorityLevel")
    for code, name, order in PROVISIONAL_LEVELS:
        PriorityLevel.objects.get_or_create(
            code=code, defaults={"name": name, "order": order, "is_provisional": True}
        )


def delete_levels(apps, schema_editor):
    PriorityLevel = apps.get_model("incidents", "PriorityLevel")
    PriorityLevel.objects.filter(
        code__in=[code for code, _, _ in PROVISIONAL_LEVELS], incidents__isnull=True
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("incidents", "0003_planning_schema"),
    ]

    operations = [
        migrations.RunPython(create_levels, delete_levels),
    ]
