# Encuesta de satisfacción por cierre técnico (ADR 0012). Generada por Django 6.0.10.

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('incidents', '0007_membership_can_verify'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='SatisfactionSurvey',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('rating', models.PositiveSmallIntegerField(verbose_name='calificación')),
                ('comment', models.TextField(blank=True, verbose_name='comentario')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='respondida')),
                ('closing_intervention', models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name='satisfaction_survey', to='incidents.incidentintervention', verbose_name='cierre evaluado')),
                ('incident', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='satisfaction_surveys', to='incidents.incident')),
                ('respondent', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL, verbose_name='respondida por')),
            ],
            options={
                'verbose_name': 'encuesta de satisfacción',
                'verbose_name_plural': 'encuestas de satisfacción',
                'ordering': ('created_at', 'id'),
                'constraints': [models.CheckConstraint(condition=models.Q(('rating__gte', 1), ('rating__lte', 5)), name='satisfaction_rating_1_to_5')],
            },
        ),
    ]
