# ADR 0001 — Modelo de usuario personalizado sobre una base ya migrada

- **Estado:** reemplazado por [ADR 0002](0002-autenticacion-y-roles.md). No se aplicó: se optó por una base nueva.
- **Fecha:** 2026-11-06

## Contexto

Las migraciones iniciales de `django.contrib` (`auth`, `admin`, `contenttypes`,
`sessions`) ya se aplicaron en PostgreSQL usando `auth.User`. Se requiere
autenticación individual con roles, por lo que conviene un modelo propio
(`accounts.User`). Cambiar `AUTH_USER_MODEL` después de migrar no está soportado
de forma automática por Django y la base de datos debe conservarse.

## Opciones evaluadas

| Opción | Destructiva | Esfuerzo | Flexibilidad |
|---|---|---|---|
| A. Borrar y recrear la base | **Sí** | Bajo | Alta | 
| B. `accounts.User` reutilizando la tabla `auth_user` | No | Medio | Alta |
| C. Mantener `auth.User` + `Profile` 1:1 y roles con `Group` | No | Bajo | Media |

A queda descartada por requisito. C evita tocar metadatos, pero obliga a un `JOIN`
permanente y no permite cambiar el identificador de inicio de sesión (p. ej. correo)
ni añadir campos obligatorios al usuario.

## Decisión propuesta: opción B

1. **Respaldo previo:** `pg_dump -Fc` de la base antes de cualquier paso.
2. Crear la app `apps.accounts` con:
   ```python
   class User(AbstractUser):
       class Meta:
           db_table = "auth_user"   # reutiliza la tabla existente
   ```
   Las tablas M2M (`auth_user_groups`, `auth_user_user_permissions`) derivan del
   `db_table`, así que coinciden con las existentes.
3. Configurar `AUTH_USER_MODEL = "accounts.User"` y generar `accounts/0001_initial`
   (equivalente exacto al esquema actual de `auth_user`).
4. Registrar esa migración como aplicada **sin ejecutar DDL**. `migrate --fake`
   no sirve: Django lanza `InconsistentMigrationHistory` porque `admin.0001` ya
   está aplicada y depende de `AUTH_USER_MODEL`. Se hace con una única inserción
   de metadatos, dentro de una transacción:
   ```sql
   INSERT INTO django_migrations (app, name, applied)
   VALUES ('accounts', '0001_initial', now());
   UPDATE django_content_type SET app_label = 'accounts'
   WHERE app_label = 'auth' AND model = 'user';
   ```
5. Verificar con `manage.py migrate --plan` (debe estar vacío) y
   `makemigrations --check --dry-run` (sin cambios).
6. A partir de ahí, los campos nuevos (rol, área, teléfono, etc.) se añaden con
   migraciones normales y aditivas. Renombrar la tabla a `accounts_user`
   (`AlterModelTable`) es opcional y puede hacerse más adelante.

Solo se modifican filas de metadatos (`django_migrations`, `django_content_type`);
no se borran tablas ni datos. Es reversible restaurando el respaldo o revirtiendo
ambas sentencias.

## Condiciones

- Hacerlo **antes** de crear cualquier otra app con claves foráneas al usuario.
- Probar primero el procedimiento en una copia de la base (`createdb -T`).
- Requiere autorización explícita para ejecutarse.
