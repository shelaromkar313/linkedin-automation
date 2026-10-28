"""
Lightweight HTTP API Server for n8n and External Webhook Triggers
Allows n8n (running on EC2 or Docker) to trigger LinkedIn outreach automatically at 8:00 AM.
"""
import json
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from typing import Dict, Any

from src.config import config
from src.database.db import Database, LeadStatus
from src.scraper.xray import XRaySearcher
from src.ai.generator import AIPersonalizer
from src.bot.dispatcher import OutreachDispatcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("n8n_server")

class N8NRequestHandler(BaseHTTPRequestHandler):
    """Handles webhook requests from n8n."""

    def _send_json_response(self, status_code: int, data: Dict[str, Any]):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2, default=str).encode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/" or path == "/health":
            self._send_json_response(200, {
                "status": "HEALTHY",
                "message": "LinkedIn Automation Engine is active and ready for n8n.",
                "daily_sent_count": Database().count_sent_in_last_24h(),
                "daily_limit": config.MAX_DAILY_INVITES,
            })
            return

        if path == "/run-outreach":
            # Extract optional parameters from n8n query
            limit_raw = query.get("limit", ["10"])[0].rstrip("/ ")
            limit = int(limit_raw) if limit_raw.isdigit() else 10
            title = query.get("title", ["CEO"])[0].strip("/ ")
            keyword = query.get("keyword", ["SaaS"])[0].strip("/ ")
            location = query.get("location", ["Pune"])[0].rstrip("/0 ").strip()
            if not location:
                location = "Pune"
            dry_run = query.get("dry_run", ["false"])[0].lower() in ("true", "1")

            logger.info(f"Received outreach trigger from n8n: limit={limit}, title={title}, location={location}, keyword={keyword}, dry_run={dry_run}")

            def execute_outreach_worker():
                try:
                    db = Database()
                    ai = AIPersonalizer()
                    searcher = XRaySearcher()
                    dispatcher = OutreachDispatcher(db=db, ai=ai)

                    # 1. Scrape fresh leads or retry previous failed leads
                    pending_count = len(db.get_leads_by_status(LeadStatus.GENERATED, limit=limit))
                    leads_discovered = 0
                    if pending_count < limit:
                        needed = limit - pending_count
                        # Reset any previously failed leads to give them a fresh attempt with updated selectors
                        failed_leads = db.get_leads_by_status(LeadStatus.FAILED, limit=needed)
                        for fl in failed_leads:
                            db.update_lead_status(fl["id"], LeadStatus.PENDING)
                        
                        # Check if we still need more leads from X-Ray search
                        curr_pending = db.get_leads_by_status(LeadStatus.PENDING, limit=needed)
                        if len(curr_pending) < needed:
                            scrape_needed = needed - len(curr_pending)
                            logger.info(f"Scraping up to {scrape_needed} fresh prospects for {title} in {location}...")
                            xray_q = searcher.build_query(title, keyword, location)
                            logger.info(f"Executing X-Ray Query: {xray_q}")
                            discovered = searcher.search(xray_q, limit=scrape_needed)
                            for lead in discovered:
                                db.add_lead(
                                    name=lead["name"],
                                    headline=lead["headline"],
                                    linkedin_url=lead["linkedin_url"],
                                )
                            leads_discovered = len(discovered)
                            logger.info(f"Added {leads_discovered} leads to database.")

                    # 2. Personalize connection notes (strict <= 200 chars)
                    pending_notes = db.get_leads_by_status(LeadStatus.PENDING, limit=limit)
                    logger.info(f"Generating AI connection notes for {len(pending_notes)} pending leads...")
                    for p in pending_notes:
                        note = ai.generate_note(p["name"], p["headline"])
                        db.update_lead_note(p["id"], note)

                    # 3. Dispatch automated invites
                    logger.info(f"Dispatching automated invites (limit={limit}, headless=True)...")
                    dispatch_results = dispatcher.dispatch_batch(limit=limit, dry_run=dry_run, headless=True)
                    logger.info(f"Dispatch finished: {dispatch_results}")
                except Exception as ex:
                    logger.error(f"Error in background outreach worker: {ex}", exc_info=True)

            # Start worker in background thread to prevent HTTP socket timeouts
            import threading
            worker_thread = threading.Thread(target=execute_outreach_worker, daemon=True)
            worker_thread.start()

            # Respond immediately to n8n with HTTP 200 success
            db = Database()
            self._send_json_response(200, {
                "status": "STARTED",
                "message": f"Outreach pipeline successfully initiated in background for {limit} {title} leads in {location}.",
                "daily_sent_count": db.count_sent_in_last_24h(),
                "daily_limit": config.MAX_DAILY_INVITES,
            })
            return

        self._send_json_response(404, {"error": "Not Found", "available_endpoints": ["/health", "/run-outreach"]})

def run_server(port: int = 8000, host: str = "0.0.0.0"):
    server_address = (host, port)
    httpd = HTTPServer(server_address, N8NRequestHandler)
    print(f"\n=======================================================")
    print(f"🚀 LinkedIn Outreach API Server running on http://{host}:{port}")
    print(f"   Webhook Endpoint: http://localhost:{port}/run-outreach?limit=10&title=CEO&location=Pune")
    print(f"=======================================================\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == "__main__":
    run_server()
