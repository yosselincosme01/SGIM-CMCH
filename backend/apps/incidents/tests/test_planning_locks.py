"""
Regresión: bloqueos de planificación en PostgreSQL.

Error original: ``FOR UPDATE cannot be applied to the nullable side of an outer
join``. Bloquear la incidencia con ``select_related("priority")`` (FK opcional, LEFT
OUTER JOIN) generaba un ``FOR UPDATE`` que incluía el lado nulable. La corrección
bloquea solo la fila propia: ``FOR UPDATE OF "incidents_incident"``.

SQLite ignora ``select_for_update``; por eso la primera prueba compila el SQL con el
backend de PostgreSQL sin conectarse, y las demás se ejecutan solo en PostgreSQL.
"""

import threading
from datetime import timedelta

import pytest
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError, connection, transaction
from django.db.backends.postgresql.base import DatabaseWrapper
from django.utils import timezone

from apps.accounts.roles import Role
from apps.incidents import planning_services
from apps.incidents.models import Incident, PriorityLevel
from apps.incidents.services import create_incident

only_postgresql = pytest.mark.skipif(
    connection.vendor != "postgresql", reason="Bloqueos reales solo en PostgreSQL"
)


def _offline_postgresql_connection() -> DatabaseWrapper:
    """Conexión de PostgreSQL que solo compila SQL: cualquier intento de conectar falla."""
    wrapper = DatabaseWrapper(
        {**settings.DATABASES["default"], "ENGINE": "django.db.backends.postgresql"}
    )

    def blocked(*args, **kwargs):
        raise AssertionError("La prueba no debe conectarse a ninguna base de datos.")

    wrapper.ensure_connection = blocked
    wrapper.connect = blocked
    wrapper.get_autocommit = lambda: False  # simula estar dentro de una transacción
    wrapper.__dict__["pg_version"] = 180000
    return wrapper


def _postgresql_sql(queryset) -> str:
    sql, _ = queryset.query.get_compiler(connection=_offline_postgresql_connection()).as_sql()
    return sql


def test_incident_lock_only_locks_the_incident_row():
    sql = _postgresql_sql(planning_services.incident_lock_queryset().filter(pk=1))

    # El escenario del error sigue presente (FK opcional con LEFT OUTER JOIN)...
    assert 'LEFT OUTER JOIN "incidents_prioritylevel"' in sql
    # ...pero el bloqueo se limita a la incidencia.
    assert sql.rstrip().endswith('FOR UPDATE OF "incidents_incident"')


def test_current_assignment_lock_does_not_lock_the_technician_user():
    incident = Incident(pk=1)
    sql = _postgresql_sql(planning_services.current_assignment_lock_queryset(incident))

    assert 'INNER JOIN "accounts_user"' in sql
    assert sql.rstrip().endswith('FOR UPDATE OF "incidents_incidentassignment"')


# --- Solo PostgreSQL ------------------------------------------------------------


@pytest.fixture
def planning_setup(make_user, solicitante, care_unit, area_ti):
    planner = make_user("plan.lock", Role.PLANIFICADOR, plans=("ti",))
    tech = make_user("tec.lock", Role.PERSONAL_ATENCION, assigned=("ti",))
    incident = create_incident(
        user=solicitante,
        care_unit=care_unit,
        support_area=area_ti,
        description="Incidencia ficticia para probar bloqueos",
    )
    return planner, tech, incident


@only_postgresql
@pytest.mark.django_db
def test_incident_with_and_without_priority_can_be_locked(planning_setup):
    """Reproduce el error original: priority nula (LEFT OUTER JOIN) y con valor."""
    planner, tech, incident = planning_setup
    with transaction.atomic():
        assert planning_services._lock(incident).priority is None

    planning_services.set_priority(
        incident=incident, actor=planner, priority=PriorityLevel.objects.get(code="alta")
    )
    planning_services.schedule_attention(
        incident=incident,
        actor=planner,
        priority=PriorityLevel.objects.get(code="critica"),
        technician=tech,
        scheduled_at=timezone.now() + timedelta(days=1),
    )
    incident.refresh_from_db()
    assert incident.status == Incident.Status.ASIGNADA


@only_postgresql
@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_lock_blocks_the_incident_but_not_shared_rows(planning_setup):
    """
    Mientras una transacción planifica, otra no puede tomar la incidencia, pero sí la
    fila del técnico y la del nivel de prioridad (no se bloquean de más).
    """
    planner, tech, incident = planning_setup
    planning_services.schedule_attention(
        incident=incident,
        actor=planner,
        priority=PriorityLevel.objects.get(code="alta"),
        technician=tech,
        scheduled_at=timezone.now() + timedelta(days=1),
    )
    locked, release, errors = threading.Event(), threading.Event(), []

    def holder():
        try:
            with transaction.atomic():
                planning_services._lock(incident)
                planning_services.current_assignment_lock_queryset(incident).first()
                locked.set()
                release.wait(timeout=10)
        except Exception as exc:  # pragma: no cover - se informa en la aserción
            errors.append(repr(exc))
            locked.set()
        finally:
            connection.close()

    thread = threading.Thread(target=holder)
    thread.start()
    try:
        assert locked.wait(timeout=10)
        assert errors == []
        with pytest.raises(DatabaseError), transaction.atomic():
            Incident.objects.select_for_update(nowait=True).get(pk=incident.pk)
        with transaction.atomic():
            get_user_model().objects.select_for_update(nowait=True).get(pk=tech.pk)
            PriorityLevel.objects.select_for_update(nowait=True).get(code="alta")
    finally:
        release.set()
        thread.join()
    assert errors == []
