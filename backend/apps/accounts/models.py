from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models.functions import Lower


class User(AbstractUser):
    """
    Cuenta individual del personal de la clínica.

    - Cada persona tiene su propia cuenta (``username`` y contraseña). No se permiten
      cuentas compartidas: el ``username`` es único sin distinguir mayúsculas
      ("ana.prueba" y "Ana.Prueba" no pueden coexistir).
    - Los roles se asignan con Groups de Django; un usuario puede tener varios.
    - El usuario **no** se vincula a una UPS o servicio: el personal puede rotar
      entre unidades, y la UPS donde ocurre una incidencia es un dato del ticket.
    - No almacena datos de pacientes.
    """

    class Meta(AbstractUser.Meta):
        verbose_name = "usuario"
        verbose_name_plural = "usuarios"
        swappable = "AUTH_USER_MODEL"
        constraints = [
            models.UniqueConstraint(
                Lower("username"),
                name="accounts_user_username_ci_unique",
                violation_error_message="Ya existe un usuario con ese nombre de usuario.",
            ),
        ]

    @property
    def full_name(self) -> str:
        return self.get_full_name() or self.username
