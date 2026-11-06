"""Casos de uso de incidencias. Toda escritura pasa por aquí (no por los serializers)."""

from django.db import transaction
from django.utils import timezone

from .attachments import EvidenceImage
from .models import Incident, IncidentAttachment, IncidentEvent


def format_incident_code(year: int, pk: int) -> str:
    """
    Código legible y único: INC-<año>-<número>.

    El número es la clave primaria (secuencia de la base de datos), así que dos
    registros simultáneos nunca reciben el mismo código, sin bloqueos adicionales.
    La columna ``code`` además tiene una restricción UNIQUE.
    """
    return f"INC-{year}-{pk:06d}"


@transaction.atomic
def create_incident(
    *,
    user,
    care_unit,
    support_area,
    description: str,
    prior_actions: str = "",
    asset_reference: str = "",
    evidence: EvidenceImage | None = None,
) -> Incident:
    """
    Registra una incidencia en estado inicial, con su evidencia opcional y su evento
    de trazabilidad. El usuario autenticado queda registrado como autor.

    La evidencia debe venir de ``attachments.prepare_evidence_image``: validada y sin
    metadatos. Nunca se guarda el archivo tal como lo envió el cliente.
    """
    incident = Incident.objects.create(
        care_unit=care_unit,
        support_area=support_area,
        description=description,
        prior_actions=prior_actions,
        asset_reference=asset_reference,
        created_by=user,
    )
    incident.code = format_incident_code(timezone.localtime(incident.created_at).year, incident.pk)
    incident.save(update_fields=["code"])

    attachment = None
    stored_file = None
    try:
        if evidence is not None:
            if not isinstance(evidence, EvidenceImage):
                raise TypeError("La evidencia debe prepararse con prepare_evidence_image.")
            info = evidence.info
            attachment = IncidentAttachment(
                incident=incident,
                original_name=evidence.original_name,
                content_type=info.content_type,
                extension=info.extension,
                size=info.size,
                width=info.width,
                height=info.height,
                uploaded_by=user,
                uploaded_at=timezone.now(),
            )
            attachment.file.save("evidencia", evidence.file, save=False)
            stored_file = (attachment.file.storage, attachment.file.name)
            attachment.save()

        IncidentEvent.objects.create(
            incident=incident,
            event_type=IncidentEvent.Type.CREATED,
            actor=user,
            to_status=incident.status,
            details={"has_attachment": attachment is not None},
        )
    except Exception:
        # La transacción se revierte: el archivo ya escrito no debe quedar huérfano.
        if stored_file:
            storage, name = stored_file
            storage.delete(name)
        raise
    return incident
