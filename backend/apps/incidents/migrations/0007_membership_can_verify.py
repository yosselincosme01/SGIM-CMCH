"""
Función independiente «Verificar conformidad» por área (ADR 0008).

Hasta ahora, verificar un cierre técnico era parte de la función de planificar
(``can_plan``). Para no quitar a nadie un acceso que ya tenía, esta migración copia
``can_plan`` en ``can_verify`` **una sola vez**. A partir de aquí, ambas funciones se
gestionan por separado: cambiar una no cambia la otra.

La migración inversa no modifica datos: al deshacerla, se elimina la columna.
"""

from django.db import migrations, models


def copy_planning_to_verification(apps, schema_editor):
    membership = apps.get_model("incidents", "SupportAreaMembership")
    membership.objects.filter(can_plan=True, can_verify=False).update(can_verify=True)


class Migration(migrations.Migration):
    dependencies = [
        ("incidents", "0006_attention_workflow"),
    ]

    operations = [
        migrations.AddField(
            model_name="supportareamembership",
            name="can_verify",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Requiere una cuenta operativa activa, no el rol Planificador. Es "
                    "independiente de «puede planificar». Nadie verifica un cierre de una "
                    "intervención que ejecutó."
                ),
                verbose_name="puede verificar conformidad",
            ),
        ),
        migrations.RunPython(copy_planning_to_verification, migrations.RunPython.noop),
    ]
