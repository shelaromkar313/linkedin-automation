"""
Unit tests for SQLite database layer, lead state machine, and deduplication.
"""

import os
import tempfile
import pytest
from src.database.db import Database, LeadStatus


@pytest.fixture
def temp_db(tmp_path):
    path = str(tmp_path / "test_leads.db")
    db = Database(db_path=path)
    return db


def test_schema_initialization(temp_db):
    """Verify SQLite table is created."""
    stats = temp_db.get_summary_stats()
    assert stats["TOTAL"] == 0
    assert stats[LeadStatus.PENDING] == 0


def test_lead_deduplication(temp_db):
    """Verify duplicate LinkedIn URLs are rejected."""
    id1 = temp_db.add_lead(
        name="Revanth Dasoji",
        headline="CEO at American IT Systems",
        linkedin_url="https://www.linkedin.com/in/revanth-dasoji-5870322a/",
    )
    assert id1 is not None

    # Attempt to insert same profile with different query params and case
    id2 = temp_db.add_lead(
        name="Revanth D.",
        headline="CEO",
        linkedin_url="https://in.linkedin.com/in/revanth-dasoji-5870322a/?trackingId=xyz",
    )
    assert id2 is None  # Duplicate rejected

    stats = temp_db.get_summary_stats()
    assert stats["TOTAL"] == 1


def test_state_transitions(temp_db):
    """Verify PENDING -> GENERATED -> SENT lifecycle."""
    lead_id = temp_db.add_lead(
        name="Peter Day",
        headline="CEO at Optimize to Convert",
        linkedin_url="https://www.linkedin.com/in/peterday448/",
    )

    # 1. Initially PENDING
    pending = temp_db.get_leads_by_status(LeadStatus.PENDING)
    assert len(pending) == 1
    assert pending[0]["id"] == lead_id

    # 2. Transition to GENERATED
    note = "Hi Peter, great seeing your work in media buying. Would love to connect!"
    temp_db.update_lead_note(lead_id, note)
    generated = temp_db.get_leads_by_status(LeadStatus.GENERATED)
    assert len(generated) == 1
    assert generated[0]["connection_note"] == note

    # 3. Transition to SENT
    temp_db.update_lead_status(lead_id, LeadStatus.SENT)
    sent = temp_db.get_leads_by_status(LeadStatus.SENT)
    assert len(sent) == 1
    assert sent[0]["sent_at"] is not None

    stats = temp_db.get_summary_stats()
    assert stats[LeadStatus.SENT] == 1
    assert stats["SENT_LAST_24H"] == 1


def test_csv_export_import(temp_db, tmp_path):
    """Verify exporting leads to CSV and re-importing."""
    temp_db.add_lead(name="Alice", headline="Founder", linkedin_url="https://linkedin.com/in/alice/")
    temp_db.add_lead(name="Bob", headline="CTO", linkedin_url="https://linkedin.com/in/bob/")

    csv_file = str(tmp_path / "leads.csv")
    exported_count = temp_db.export_to_csv(csv_file)
    assert exported_count == 2
    assert os.path.exists(csv_file)

    # Import into a new fresh DB
    new_db = Database(db_path=str(tmp_path / "imported.db"))
    res = new_db.import_from_csv(csv_file)
    assert res["inserted"] == 2
    assert res["duplicates"] == 0
