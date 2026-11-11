# Encuesta de satisfacción: guía funcional

Decisión técnica: [ADR 0012](adr/0012-encuesta-de-satisfaccion.md).

## Satisfacción no es verificación

- **Encuesta de satisfacción:** la responde, si quiere, **quien registró la
  incidencia**. Califica su experiencia de 1 a 5 estrellas, con un comentario opcional.
  No cambia el estado del ticket.
- **Verificación técnica:** la registra **el Responsable de Área** con la función de
  verificar. Indica si el trabajo quedó Conforme o No conforme y, si no es conforme,
  permite reabrir.

Una no reemplaza a la otra, y se pueden registrar en cualquier orden.

## Para el solicitante

1. Al iniciar sesión, si tienes atenciones finalizadas sin evaluar, verás **una vez por
   sesión** un recordatorio. Con «Evaluar atención» vas al ticket con la encuesta abierta,
   y con «Ahora no» lo cierras sin responder. No vuelve a aparecer hasta tu próximo
   inicio de sesión.
1. Cuando el área de soporte cierra técnicamente tu incidencia, verás:
   - **Inicio:** el indicador «Encuestas pendientes»;
   - **Mis incidencias:** la marca «Evaluación pendiente»;
   - **Detalle de la incidencia:** la invitación «Tu atención fue finalizada. ¿Deseas
     evaluar el servicio recibido?».
2. Pulsa **Evaluar atención**, elige de 1 a 5 estrellas (también con las flechas del
   teclado) y, si quieres, escribe un comentario.
3. **Enviar evaluación** se habilita al elegir una calificación. **Ahora no** (o la tecla
   Escape) cierra sin enviar: podrás responder después.
4. Cada cierre se evalúa una sola vez. Tus evaluaciones anteriores aparecen en «Tus
   evaluaciones».
5. Si la incidencia se reabre antes de que respondas, esa encuesta deja de estar
   disponible. Cuando se vuelva a cerrar, podrás evaluar el nuevo cierre.

## Para el Responsable de Área y el Administrador

- **Responsable de Área:** en el detalle de los tickets de las áreas donde planifica o
  verifica, ve la sección «Satisfacción del solicitante». Un técnico no la ve.
- **Administrador:** ve las evaluaciones en la consulta global de solo lectura, los
  indicadores en el Panel de Administración y el reporte en **Análisis → Reportes**.
- **Indicadores:** promedio sobre 5, respondidas, pendientes de respuesta y tasa de
  respuesta (respondidas entre cierres técnicos del periodo). Una encuesta sin responder
  no se considera insatisfacción.

## Validación con datos ficticios

Requiere aplicar la migración `incidents.0008_satisfaction_survey`, **solo con
autorización**.

1. Con un Responsable de Área y un técnico ficticios, programa y cierra («Solucionado»)
   una incidencia registrada por un solicitante ficticio.
2. Entra como ese solicitante y abre la incidencia en Mis incidencias. Comprueba:
   - que el modal no se abre solo;
   - que «Ahora no» y Escape lo cierran sin enviar;
   - que «Enviar evaluación» está deshabilitado hasta elegir estrellas.
3. Envía 4 estrellas. Comprueba que aparece la confirmación, que la invitación
   desaparece y que la evaluación queda en «Tus evaluaciones».
4. Como Responsable de Área del área, abre el ticket desde Verificaciones. Comprueba que
   ves la evaluación y que la verificación sigue disponible y no cambió.
5. Registra «No conforme», reabre y vuelve a cerrar. Como solicitante, comprueba que
   puedes evaluar el nuevo cierre y que la evaluación anterior se conserva.
6. Como Administrador, revisa el Panel de Administración y descarga el reporte
   «Satisfacción del solicitante».
