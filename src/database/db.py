"""
SQLite Database Layer for Lead Tracking & Outreach State Machine.
"""

import csv
import re
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional
from ..config import config


class LeadStatus:
    PENDING = "PENDING"
    GENERATED = "GENERATED"
    SENT = "SENT"
    FAILED = "FAILED"


def normalize_linkedin_url(url: str) -> str:
    """Normalize LinkedIn URL to canonical format: https://www.linkedin.com/in/username/"""
    if not url:
        return ""
    clean = url.strip()
    # Strip tracking parameters and anchors
    clean = re.sub(r"[?#].*$", "", clean)
    # Ensure protocol
    if not clean.startswith("http"):
        clean = "https://" + clean
    # Clean mobile / locale prefixes like in.linkedin.com or www.linkedin.com/in/username/en
    clean = re.sub(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com", "https://www.linkedin.com", clean)
    clean = re.sub(r"/(?:en|es|fr|de|pt)/?$", "", clean)
    # Ensure trailing slash
    clean = clean.rstrip("/") + "/"
    return clean.lower()


class Database:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or config.DATABASE_PATH
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.init_schema()

    def get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_schema(self) -> None:
        """Create schema if it does not already exist."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS leads (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    headline TEXT,
                    linkedin_url TEXT UNIQUE NOT NULL,
                    status TEXT NOT NULL DEFAULT 'PENDING',
                    connection_note TEXT,
                    sent_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_leads_sent_at ON leads(sent_at);"
            )
            conn.commit()

    def add_lead(self, name: str, headline: str, linkedin_url: str) -> Optional[int]:
        """
        Add candidate to DB with deduplication.
        Returns lead id if inserted, None if duplicate or invalid.
        """
        canonical_url = normalize_linkedin_url(linkedin_url)
        if not canonical_url or "/in/" not in canonical_url:
            return None

        clean_name = (name or "").strip()
        clean_headline = (headline or "").strip()

        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(
                    """
                    INSERT INTO leads (name, headline, linkedin_url, status, created_at)
                    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    (clean_name, clean_headline, canonical_url, LeadStatus.PENDING),
                )
                conn.commit()
                return cursor.lastrowid
            except sqlite3.IntegrityError:
                # Already exists in DB
                return None

    def get_leads_by_status(self, status: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Fetch leads filtered by status ordered by id."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, headline, linkedin_url, status, connection_note, sent_at, created_at
                FROM leads
                WHERE status = ?
                ORDER BY id ASC
                LIMIT ?
                """,
                (status, limit),
            )
            return [dict(row) for row in cursor.fetchall()]

    def update_lead_note(self, lead_id: int, connection_note: str) -> bool:
        """Store generated AI connection note and mark as GENERATED."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE leads
                SET connection_note = ?, status = ?
                WHERE id = ?
                """,
                (connection_note, LeadStatus.GENERATED, lead_id),
            )
            conn.commit()
            return cursor.rowcount > 0

    def update_lead_status(
        self, lead_id: int, status: str, error_message: Optional[str] = None
    ) -> bool:
        """Update lead status to SENT or FAILED."""
        sent_timestamp = datetime.now(timezone.utc).isoformat() if status == LeadStatus.SENT else None
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE leads
                SET status = ?, sent_at = COALESCE(?, sent_at)
                WHERE id = ?
                """,
                (status, sent_timestamp, lead_id),
            )
            conn.commit()
            return cursor.rowcount > 0

    def count_sent_in_last_24h(self) -> int:
        """Count connection requests sent in the last 24 hours to enforce anti-ban limits."""
        since_time = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT COUNT(*) FROM leads
                WHERE status = ? AND sent_at >= ?
                """,
                (LeadStatus.SENT, since_time),
            )
            row = cursor.fetchone()
            return row[0] if row else 0

    def get_summary_stats(self) -> Dict[str, int]:
        """Get counts for all statuses."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT status, COUNT(*) as count
                FROM leads
                GROUP BY status
                """
            )
            stats = {LeadStatus.PENDING: 0, LeadStatus.GENERATED: 0, LeadStatus.SENT: 0, LeadStatus.FAILED: 0}
            total = 0
            for row in cursor.fetchall():
                st = row["status"]
                cnt = row["count"]
                stats[st] = cnt
                total += cnt
            stats["TOTAL"] = total
            stats["SENT_LAST_24H"] = self.count_sent_in_last_24h()
            return stats

    def export_to_csv(self, filepath: str) -> int:
        """Export all leads to CSV file."""
        out_path = Path(filepath)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT id, name, headline, linkedin_url, status, connection_note, sent_at, created_at
                FROM leads
                ORDER BY id ASC
                """
            )
            rows = cursor.fetchall()

        with open(out_path, mode="w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["id", "name", "headline", "linkedin_url", "status", "connection_note", "sent_at", "created_at"])
            for row in rows:
                writer.writerow(list(row))

        return len(rows)

    def import_from_csv(self, filepath: str) -> Dict[str, int]:
        """
        Import leads from CSV (compatible with Octopus CRM, Apollo, or custom exports).
        """
        in_path = Path(filepath)
        if not in_path.exists():
            raise FileNotFoundError(f"CSV file not found: {filepath}")

        inserted = 0
        duplicates = 0

        with open(in_path, mode="r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            # Find column names case-insensitively
            fieldnames = [c.lower().strip() for c in (reader.fieldnames or [])]

            def find_col(aliases: List[str]) -> Optional[str]:
                for alias in aliases:
                    for actual in (reader.fieldnames or []):
                        if actual.lower().strip() == alias:
                            return actual
                return None

            name_col = find_col(["name", "full name", "prospect name", "lead name"])
            headline_col = find_col(["headline", "title", "job title", "occupation", "role"])
            url_col = find_col(["linkedin_url", "linkedin url", "profile url", "url", "link", "linkedin"])

            for row in reader:
                name = (row.get(name_col) or "").strip() if name_col else ""
                headline = (row.get(headline_col) or "").strip() if headline_col else ""
                url = (row.get(url_col) or "").strip() if url_col else ""

                if not url:
                    continue

                lead_id = self.add_lead(name=name, headline=headline, linkedin_url=url)
                if lead_id:
                    inserted += 1
                else:
                    duplicates += 1

        return {"inserted": inserted, "duplicates": duplicates}


# Alias for backwards compatibility
DatabaseManager = Database
