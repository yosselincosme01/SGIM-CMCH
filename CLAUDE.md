# SGIM-CMCH: reglas permanentes del proyecto

Sistema de Gestión de Incidencias y Mantenimiento para una clínica.
Monorepo con un monolito modular: `backend/` (Python 3.14, Django 6, DRF, PostgreSQL 18) y `frontend/` (React, TypeScript, Vite).

## Responsabilidades

- Claude: desarrollo, implementación, pruebas y revisión técnica del código.
- La responsable del proyecto: **todas** las operaciones que cambian el estado de Git.

## Reglas de Git (obligatorias)

1. Claude **nunca** ejecuta `git add`, `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git switch`, `git checkout`, `git stash` ni comandos que creen o eliminen ramas o etiquetas.
2. Claude **nunca** crea, aprueba ni integra Pull Requests, ni con `gh` ni con otra herramienta.
3. Solo se permiten comandos de Git de solo lectura: `git status`, `git diff`, `git log`, `git show`, `git branch` (para listar), `git check-ignore`, `git ls-files`.
4. Cuando corresponda hacer un commit, Claude se detiene y avisa.
5. Antes de cada commit, Claude verifica y reporta:
   - los archivos modificados o nuevos (`git status`, `git diff`);
   - las pruebas y comprobaciones ejecutadas, con su resultado;
   - que no haya secretos ni archivos sensibles preparados para Git.
6. Claude entrega los comandos exactos de **PowerShell** para cada operación de Git, con una breve explicación de cada uno.
7. Claude no pasa a la siguiente etapa hasta que la responsable confirme que terminó las operaciones de Git.

## Estrategia de ramas: Git Flow simplificado

- `main`: rama estable, solo para versiones validadas.
- `develop`: rama de integración.
- `feature/…` (funcionalidades), `chore/…` (configuración) y `fix/…` (correcciones) se crean desde `develop` y vuelven a `develop` por Pull Request, después de pasar sus pruebas.

## Seguridad y datos

- No leer, listar ni mostrar `backend/.env` ni otros secretos. Para verificar Django, usar una copia aislada con valores ficticios.
- No ejecutar migraciones ni comandos que modifiquen la base de datos sin autorización explícita.
- No usar datos reales de pacientes en código, pruebas, fixtures ni ejemplos.
- Decisiones de arquitectura: `docs/adr/`.
