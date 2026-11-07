"""
Identificación del equipo mediante QR (ADR 0005).

- Agrega ``equipment_qr_status``, ``qr_code`` y ``qr_capture_method``.
- Las incidencias existentes quedan como ``unspecified`` (sin dato de identificación).
  El valor por defecto solo se usa para esas filas: la columna queda sin default.
- Agrega un índice parcial sobre ``qr_code`` y las restricciones CHECK que exigen una
  combinación coherente.
- **No elimina datos.** ``asset_reference`` se conserva como campo legado: solo cambian
  su etiqueta y su ayuda; su columna y su contenido no se modifican.
"""

from django.db import migrations, models
from django.db.models import Q

QR_STATUS_CHOICES = [
    ("qr_readable", "Tiene QR y puedo leerlo"),
    ("qr_unreadable", "Tiene QR, pero no puedo leerlo"),
    ("no_qr", "El equipo no tiene QR"),
    ("not_equipment", "No corresponde a un equipo"),
    ("unspecified", "Sin dato de identificación (incidencia anterior)"),
]
CAPTURE_CHOICES = [("manual", "Escrito por el usuario"), ("scan", "Leído con la cámara")]


class Migration(migrations.Migration):
    dependencies = [
        ("incidents", "0004_provisional_priority_levels"),
    ]

    operations = [
        migrations.AlterField(
            model_name="incident",
            name="asset_reference",
            field=models.CharField(
                blank=True,
                editable=False,
                help_text=(
                    "Campo legado: no se usa en registros nuevos ni en la API. Se eliminará "
                    "al integrar el inventario institucional (ADR 0005)."
                ),
                max_length=100,
                verbose_name="referencia del equipo (legado)",
            ),
        ),
        migrations.AddField(
            model_name="incident",
            name="equipment_qr_status",
            field=models.CharField(
                choices=QR_STATUS_CHOICES,
                default="unspecified",
                editable=False,
                max_length=20,
                verbose_name="identificación del equipo",
            ),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name="incident",
            name="qr_code",
            field=models.CharField(
                blank=True,
                editable=False,
                help_text="Texto leído, sin interpretar. Pendiente de validar contra el inventario.",
                max_length=255,
                verbose_name="contenido del QR",
            ),
        ),
        migrations.AddField(
            model_name="incident",
            name="qr_capture_method",
            field=models.CharField(
                blank=True,
                choices=CAPTURE_CHOICES,
                editable=False,
                max_length=10,
                verbose_name="forma de captura del QR",
            ),
        ),
        migrations.AddIndex(
            model_name="incident",
            index=models.Index(
                condition=~Q(qr_code=""), fields=["qr_code"], name="incident_qr_code_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="incident",
            constraint=models.CheckConstraint(
                condition=Q(
                    equipment_qr_status__in=[
                        "qr_readable",
                        "qr_unreadable",
                        "no_qr",
                        "not_equipment",
                        "unspecified",
                    ]
                ),
                name="incident_qr_status_valid",
            ),
        ),
        migrations.AddConstraint(
            model_name="incident",
            constraint=models.CheckConstraint(
                condition=(
                    Q(equipment_qr_status="qr_readable", qr_capture_method__in=["manual", "scan"])
                    & ~Q(qr_code="")
                    & ~Q(qr_code__regex=r"^\s|\s$")
                )
                | (~Q(equipment_qr_status="qr_readable") & Q(qr_code="", qr_capture_method="")),
                name="incident_qr_code_matches_status",
            ),
        ),
    ]
