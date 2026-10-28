"""
Command Line Interface (CLI) for 100% Free LinkedIn Automated Outreach Engine.
"""

import argparse
import sys
from typing import Optional
from .config import config
from .database.db import Database, LeadStatus
from .scraper.xray import XRaySearcher
from .ai.generator import AIPersonalizer
from .bot.dispatcher import OutreachDispatcher
from .bot.auth import interactive_login


def command_search(args) -> None:
    """Execute Google X-Ray search and store leads in SQLite."""
    searcher = XRaySearcher()
    db = Database()

    # Build query
    if getattr(args, "query", None):
        # Raw query provided
        q = args.query.strip()
        if not q.startswith("site:linkedin.com/in/"):
            q = f'site:linkedin.com/in/ "{q}"'
    else:
        title = getattr(args, "title", "") or ""
        keyword = getattr(args, "keyword", "") or ""
        location = getattr(args, "location", "") or ""
        extra = getattr(args, "extra", "") or ""
        q = searcher.build_query(title, keyword, location, extra)

    limit = getattr(args, "limit", 15) or 15
    print(f"\n[CLI] 🔎 Running X-Ray Lead Discovery...")
    print(f"[CLI] Query: {q}")
    print(f"[CLI] Target Discovery Limit: {limit}")

    leads = searcher.search(q, limit=limit)

    inserted = 0
    duplicates = 0
    for lead in leads:
        lead_id = db.add_lead(
            name=lead["name"],
            headline=lead["headline"],
            linkedin_url=lead["linkedin_url"],
        )
        if lead_id:
            inserted += 1
            print(f"  [+] Added: {lead['name']} | {lead['headline'][:45]} | {lead['linkedin_url']}")
        else:
            duplicates += 1

    print(f"\n[CLI] Discovery Summary: {inserted} new leads added, {duplicates} duplicates ignored.")
    stats = db.get_summary_stats()
    print(f"[CLI] Total Leads in Database: {stats['TOTAL']} (Pending: {stats['PENDING']})")


def command_generate_notes(args) -> None:
    """Generate personalized connection notes for pending prospects."""
    db = Database()
    ai = AIPersonalizer()
    limit = getattr(args, "limit", 10) or 10

    pending = db.get_leads_by_status(LeadStatus.PENDING, limit=limit)
    if not pending:
        print("[CLI] No pending leads in database requiring note generation.")
        return

    print(f"\n[CLI] 🤖 Generating AI Personalized Notes for {len(pending)} leads...")
    print(f"[CLI] Provider: {ai.provider.upper()} (Hard limit: 200 characters)\n")

    for i, lead in enumerate(pending, 1):
        note = ai.generate_note(lead["name"], lead["headline"])
        db.update_lead_note(lead["id"], note)
        print(f"[{i}/{len(pending)}] {lead['name']}:")
        print(f"  📝 Note ({len(note)} chars): \"{note}\"")

    print(f"\n[CLI] ✅ Note generation complete for {len(pending)} leads.")


def command_dispatch(args) -> None:
    """Execute automated outreach dispatch via Playwright."""
    db = Database()
    ai = AIPersonalizer()
    dispatcher = OutreachDispatcher(db=db, ai=ai)

    limit = getattr(args, "limit", 10) or 10
    headless = getattr(args, "headless", None)
    dry_run = getattr(args, "dry_run", False)

    print(f"\n[CLI] 🚀 Initiating Automated Playwright Outreach Dispatcher...")
    if dry_run:
        print("[CLI] ⚠️ RUNNING IN DRY-RUN MODE (No actual clicks or messages sent)")

    res = dispatcher.dispatch_batch(limit=limit, headless=headless, dry_run=dry_run)
    print(f"\n[CLI] Dispatcher Finished with Status: {res.get('status')}")


def command_status(args) -> None:
    """Display real-time pipeline status and analytics."""
    db = Database()
    stats = db.get_summary_stats()

    print("\n" + "=" * 50)
    print("      LINKEDIN OUTREACH ENGINE PIPELINE STATUS      ")
    print("=" * 50)
    print(f"  Total Leads Stored:        {stats['TOTAL']}")
    print(f"  Pending Note Generation:   {stats['PENDING']}")
    print(f"  Notes Generated (Ready):   {stats['GENERATED']}")
    print(f"  Invitations Sent:          {stats['SENT']}")
    print(f"  Failed / Unreachable:      {stats['FAILED']}")
    print("-" * 50)
    print(f"  Invitations Sent (24h):    {stats['SENT_LAST_24H']} / {config.MAX_DAILY_INVITES} (Daily Limit)")
    print("=" * 50 + "\n")


def command_import_csv(args) -> None:
    """Import leads from CSV."""
    db = Database()
    filepath = args.file
    print(f"[CLI] 📥 Importing leads from CSV: {filepath}")
    res = db.import_from_csv(filepath)
    print(f"[CLI] Import Complete: {res['inserted']} inserted, {res['duplicates']} duplicates skipped.")


def command_export_csv(args) -> None:
    """Export leads from SQLite to CSV."""
    db = Database()
    filepath = getattr(args, "output", "outreach_leads.csv") or "outreach_leads.csv"
    count = db.export_to_csv(filepath)
    print(f"[CLI] 📤 Exported {count} leads to: {filepath}")


def command_login(args) -> None:
    """Interactive browser login to save session."""
    interactive_login()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="linkedin-outreach",
        description="100% Free AI-Powered LinkedIn Outreach System (No Sales Navigator, No PhantomBuster)",
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # Search
    search_parser = subparsers.add_parser("search", aliases=["run-search"], help="Scrape prospects via Google X-Ray")
    search_parser.add_argument("--query", "-q", type=str, help="Raw query string e.g. 'Founders SaaS Mumbai'")
    search_parser.add_argument("--title", "-t", type=str, default="", help="Target job title (e.g. CEO, Founder)")
    search_parser.add_argument("--keyword", "-k", type=str, default="", help="Niche keyword (e.g. SaaS, Fintech)")
    search_parser.add_argument("--location", "-l", type=str, default="", help="Location (e.g. Mumbai, Pune)")
    search_parser.add_argument("--extra", "-e", type=str, default="", help="Extra Boolean filters")
    search_parser.add_argument("--limit", "-n", type=int, default=15, help="Number of leads to fetch")
    search_parser.set_defaults(func=command_search)

    # Generate Notes
    notes_parser = subparsers.add_parser("generate-notes", help="Generate AI connection notes (<200 chars)")
    notes_parser.add_argument("--limit", "-n", type=int, default=10, help="Number of notes to generate")
    notes_parser.set_defaults(func=command_generate_notes)

    # Dispatch Invites
    dispatch_parser = subparsers.add_parser("dispatch-invites", aliases=["dispatch"], help="Dispatch connection requests via Playwright")
    dispatch_parser.add_argument("--limit", "-n", type=int, default=10, help="Max invites to dispatch")
    dispatch_parser.add_argument("--headless", action="store_true", default=None, help="Run browser in headless mode")
    dispatch_parser.add_argument("--dry-run", action="store_true", help="Simulate outreach without dispatching")
    dispatch_parser.set_defaults(func=command_dispatch)

    # Status
    status_parser = subparsers.add_parser("status", help="Show database pipeline analytics")
    status_parser.set_defaults(func=command_status)

    # Import CSV
    import_parser = subparsers.add_parser("import-csv", help="Import leads from CSV file")
    import_parser.add_argument("--file", "-f", type=str, required=True, help="Path to CSV file")
    import_parser.set_defaults(func=command_import_csv)

    # Export CSV
    export_parser = subparsers.add_parser("export", aliases=["export-csv"], help="Export database to CSV")
    export_parser.add_argument("--output", "-o", type=str, default="outreach_leads.csv", help="Destination CSV path")
    export_parser.set_defaults(func=command_export_csv)

    # Login
    login_parser = subparsers.add_parser("login", help="Open headed browser to log in to LinkedIn")
    login_parser.set_defaults(func=command_login)

    return parser


def main() -> None:
    parser = build_parser()
    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()
    if hasattr(args, "func"):
        args.func(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
