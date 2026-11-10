# Configurar las pertenencias por área (demostración)

Guía para habilitar, **de forma explícita y mínima**, a los usuarios ficticios que van a
probar la planificación y la verificación. Usa solo cuentas ficticias. Las reglas están
en el [ADR 0004](adr/0004-planificacion.md) y el [ADR 0008](adr/0008-funciones-independientes-por-area.md).

La forma habitual es la pantalla **Administrador → Gestionar usuarios**
([procedimientos](administracion.md)). El admin de Django queda para soporte técnico.

## Principios

- **Mínimo privilegio:** habilita solo la función que cada persona necesita, en el área que le corresponde.
- **Rol global y función en el área:** se necesitan los dos, salvo para verificar.

  | Para | Rol global (grupo) | Función en el área |
  |---|---|---|
  | Planificar atenciones | `planificador` | `can_plan` |
  | Registrar atenciones (recibir asignaciones) | `personal_atencion` | `can_be_assigned` |
  | Verificar conformidad | cualquier rol operativo (no exige `planificador`) | `can_verify` |

- **Funciones independientes:** planificar no implica verificar, ni al revés.
- **Separación de funciones:** nadie verifica el cierre de una atención que realizó.
- **Registrar incidencias** no requiere ninguna función: basta con cualquier rol operativo.

- **No uses superusuarios para probar.** El superusuario no tiene acceso a incidencias y
  solo debe administrar el sitio.
- **No des roles "por si acaso".** Un rol sin función en el área no da acceso, pero
  aumenta lo que habría que revisar.
- **Las funciones empiezan desactivadas.** Las migraciones no las habilitan.

## Ejemplo de configuración

| Usuario ficticio | Roles | TI | Mantenimiento |
|---|---|---|---|
| `ana.prueba` | `solicitante` | — | — |
| `plan.ti.prueba` | `planificador` | `can_plan` | — |
| `verif.ti.prueba` | `solicitante` | `can_verify` | — |
| `tec.ti.prueba` | `personal_atencion` | `can_be_assigned` | — |
| `mixto.prueba` | `planificador`, `personal_atencion` | `can_plan`, `can_verify` | `can_be_assigned` |

`mixto.prueba` sirve para comprobar que una persona puede planificar en un área y ser
técnico en otra. Sobre las incidencias de Mantenimiento no puede planificar: solo puede
recibirlas.

`verif.ti.prueba` sirve para comprobar que se puede verificar sin planificar y sin el
rol Responsable de Área. En **Verificaciones** ve los cierres de TI; no ve Planificación
ni los indicadores.

## Pasos en el admin de Django

1. Entra al admin con la cuenta de soporte técnico.
2. **Usuarios:** abre el usuario ficticio y, en **Grupos**, asígnale solo el rol o los roles necesarios.
3. **Áreas de soporte:** abre el área (por ejemplo, TI). En **Integrantes de área**, agrega
   al usuario y marca solo la casilla necesaria:
   - **Puede planificar**, para un Responsable de Área;
   - **Puede recibir asignaciones**, para un técnico;
   - **Puede verificar conformidad**, para quien verifica los cierres técnicos.
4. Guarda.
5. Revisa el resultado en **Integrantes de área**. Puedes filtrar por área y por función.

Para retirar un permiso, desmarca la casilla o elimina la pertenencia. El historial de
las incidencias no se pierde.

## Comprobaciones rápidas

- El Responsable de Área de TI ve en **Planificación** solo incidencias de TI.
- En el formulario de programación, la lista de técnicos solo muestra a quienes tienen
  `personal_atencion` y "Puede recibir asignaciones" en TI.
- Un usuario con el rol `planificador` pero sin "Puede planificar" en ningún área no ve
  la opción **Planificación** en el menú.
- El solicitante ve el estado y la fecha estimada, pero no la prioridad, el técnico ni las
  indicaciones internas.
- Un Responsable de Área sin "Puede verificar conformidad" no ve **Verificaciones**.
- Quien cerró la atención no puede verificarla, aunque tenga la función: otra persona
  autorizada debe hacerlo.

## Lo que no se debe hacer

- No marques "Puede planificar" en todas las áreas para simplificar las pruebas.
- No uses datos reales de pacientes ni de personal en las cuentas ni en las incidencias.
- No modifiques las pertenencias directamente en la base de datos: usa el admin, que
  aplica las validaciones y deja constancia de los cambios.
