"""
Crea los grupos de los roles funcionales del SGIM.

Los grupos se crean SIN permisos: se asignarán al desarrollar el módulo de incidencias.
"""

from django.db import migrations

ROLE_NAMES = ("administrador", "solicitante", "planificador", "personal_atencion")


def create_role_groups(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    for name in ROLE_NAMES:
        Group.objects.get_or_create(name=name)


def delete_role_groups(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    Group.objects.filter(name__in=ROLE_NAMES).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(create_role_groups, delete_role_groups),
    ]
