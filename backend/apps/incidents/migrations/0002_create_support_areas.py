"""
Crea las tres áreas de soporte confirmadas: TI, Ingeniería Clínica y Mantenimiento.
No crea integrantes: se asignan desde el admin.
"""

from django.db import migrations

SUPPORT_AREAS = (
    ("ti", "TI"),
    ("ingenieria_clinica", "Ingeniería Clínica"),
    ("mantenimiento", "Mantenimiento"),
)


def create_support_areas(apps, schema_editor):
    SupportArea = apps.get_model("incidents", "SupportArea")
    for code, name in SUPPORT_AREAS:
        SupportArea.objects.get_or_create(code=code, defaults={"name": name})


def delete_support_areas(apps, schema_editor):
    SupportArea = apps.get_model("incidents", "SupportArea")
    SupportArea.objects.filter(code__in=[code for code, _ in SUPPORT_AREAS]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("incidents", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_support_areas, delete_support_areas),
    ]
