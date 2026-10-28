"""
Root entrypoint for LinkedIn Automated Outreach Engine.
Usage:
    python main.py search --title "CEO" --keyword "SaaS" --location "Pune" --limit 10
    python main.py generate-notes --limit 10
    python main.py dispatch-invites --limit 10
    python main.py status
    python main.py export --output "leads.csv"
"""

from src.cli import main

if __name__ == "__main__":
    main()
