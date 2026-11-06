from django.db import models


class CareUnit(models.Model):
    """
    UPS o servicio de la clínica donde ocurre una incidencia.

    - Es un dato del contexto de cada incidencia: los usuarios NO se asocian a una UPS.
    - Todavía no existe un catálogo institucional autorizado. Los registros de
      demostración se marcan con ``is_demo=True`` y se cargan solo con el comando
      ``seed_demo_care_units``. El catálogo real se incorporará después con ``code``
      como identificador estable.
    """

    code = models.SlugField("código", max_length=40, unique=True)
    name = models.CharField("nombre", max_length=120)
    is_active = models.BooleanField("activa", default=True)
    is_demo = models.BooleanField(
        "dato de demostración",
        default=False,
        help_text="Registro ficticio de desarrollo; se reemplazará por el catálogo autorizado.",
    )
    created_at = models.DateTimeField("creado", auto_now_add=True)
    updated_at = models.DateTimeField("actualizado", auto_now=True)

    class Meta:
        verbose_name = "UPS / servicio"
        verbose_name_plural = "UPS / servicios"
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name
