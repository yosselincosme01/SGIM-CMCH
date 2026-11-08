"""
Procedimiento técnico restringido para crear un Administrador del SGIM (ADR 0007).

Solo lo ejecuta TI en el servidor, con acceso a la consola y a la configuración:

    python manage.py create_sgim_admin --username nombre.apellido --first-name Nombre \\
        --last-name Apellido --email correo@clinica

- Pide la contraseña de forma interactiva (no se acepta como argumento ni queda en el
  historial de la consola) y la valida con las reglas de Django.
- Crea una cuenta con el rol ``administrador``. **No** es superusuario ni staff: no
  entra al admin de Django ni obtiene roles operativos.
- Queda registrado en la auditoría como "procedimiento técnico".
"""

from getpass import getpass

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models.functions import Lower

from apps.accounts.roles import Role
from apps.administration.models import AuditLog


class Command(BaseCommand):
    help = "Crea un Administrador del SGIM (procedimiento técnico de TI)."

    def add_arguments(self, parser):
        parser.add_argument("--username", required=True)
        parser.add_argument("--first-name", required=True)
        parser.add_argument("--last-name", required=True)
        parser.add_argument("--email", default="")

    def handle(self, *args, **options):
        user_model = get_user_model()
        username = options["username"].strip()
        if not username:
            raise CommandError("Indica el nombre de usuario.")
        exists = (
            user_model.objects.annotate(lower=Lower("username"))
            .filter(lower=username.lower())
            .exists()
        )
        if exists:
            raise CommandError(
                "Ese nombre de usuario ya existe. No se modifican cuentas existentes."
            )

        user = user_model(
            username=username,
            first_name=options["first_name"].strip(),
            last_name=options["last_name"].strip(),
            email=options["email"].strip().lower(),
            is_active=True,
            is_staff=False,
            is_superuser=False,
        )
        password = getpass("Contraseña: ")
        if password != getpass("Repite la contraseña: "):
            raise CommandError("Las contraseñas no coinciden.")
        try:
            validate_password(password, user=user)
        except ValidationError as exc:
            raise CommandError(" ".join(exc.messages)) from exc

        with transaction.atomic():
            user.set_password(password)
            user.full_clean(exclude=["password"])
            user.save()
            user.groups.add(Group.objects.get(name=Role.ADMINISTRADOR))
            AuditLog.objects.create(
                actor=None,
                action=AuditLog.Action.ADMIN_CREATED,
                target_user=user,
                details={"username": user.username, "procedure": "create_sgim_admin"},
            )
        self.stdout.write(self.style.SUCCESS(f"Administrador «{user.username}» creado."))
