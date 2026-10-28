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
            limit = int(query.get("limit", [10])[0])
            title = query.get("title", ["CEO"])[0]
            keyword = query.get("keyword", ["SaaS"])[0]
            location = query.get("location", ["Pune"])[0]
            dry_run = query.get("dry_run", ["false"])[0].lower() in ("true", "1")

            logger.info(f"Received outreach trigger from n8n: limit={limit}, title={title}, location={location}, dry_run={dry_run}")

            db = Database()
            ai = AIPersonalizer()
            searcher = XRaySearcher()
            dispatcher = OutreachDispatcher(db=db, ai=ai)

            # 1. Scrape fresh leads if needed
            pending_count = len(db.get_leads_by_status(LeadStatus.GENERATED, limit=limit))
            leads_discovered = 0
            if pending_count < limit:
                needed = limit - pending_count
                logger.info(f"Scraping up to {needed} fresh prospects for {title} in {location}...")
                xray_q = searcher.build_query(title, keyword, location)
                discovered = searcher.search(xray_q, limit=needed)
                for lead in discovered:
                    db.add_lead(
                        name=lead["name"],
                        headline=lead["headline"],
                        linkedin_url=lead["linkedin_url"],
                    )
                leads_discovered = len(discovered)

            # 2. Personalize connection notes (strict <= 200 chars)
            pending_notes = db.get_leads_by_status(LeadStatus.PENDING, limit=limit)
            for p in pending_notes:
                note = ai.generate_note(p["name"], p["headline"])
                db.update_lead_note(p["id"], note)

            # 3. Dispatch automated invites
            dispatch_results = dispatcher.dispatch_batch(limit=limit, dry_run=dry_run)

            # 4. Return results formatted for n8n & Google Sheets
            recent_sent = db.get_leads_by_status(LeadStatus.SENT, limit=limit)
            
            self._send_json_response(200, {
                "status": "SUCCESS",
                "dispatched": dispatch_results.get("dispatched", 0),
                "failed": dispatch_results.get("failed", 0),
                "leads_discovered": leads_discovered,
                "sent_today": db.count_sent_in_last_24h(),
                "leads": [
                    {
                        "name": lead["name"],
                        "headline": lead["headline"],
                        "linkedin_url": lead["linkedin_url"],
                        "note": lead["connection_note"],
                        "status": lead["status"],
                        "sent_at": lead["sent_at"],
                    }
                    for lead in recent_sent
                ],
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
