"""
Central configuration for LinkedIn automated outreach engine.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env if present
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")


class Config:
    # 1. LinkedIn Credentials & Auth
    LINKEDIN_LI_AT = os.getenv("LINKEDIN_LI_AT", "").strip()
    STORAGE_STATE_FILE = os.getenv("LINKEDIN_STORAGE_STATE", str(ROOT_DIR / "storage_state.json"))

    # 2. Database
    DATABASE_PATH = os.getenv("DATABASE_PATH", str(ROOT_DIR / "leads.db"))

    # 3. AI Settings
    LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower()
    GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
    OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
    OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:latest")
    BUSINESS_PITCH = os.getenv(
        "BUSINESS_PITCH",
        "Unified Enterprise - IT technology solutions, telecommunications, and custom automation infrastructure",
    )

    # 4. Anti-Ban Guardrails & Delays
    MAX_DAILY_INVITES = int(os.getenv("MAX_DAILY_INVITES", "12"))
    MIN_ACTION_DELAY_SECONDS = int(os.getenv("MIN_ACTION_DELAY_SECONDS", "45"))
    MAX_ACTION_DELAY_SECONDS = int(os.getenv("MAX_ACTION_DELAY_SECONDS", "110"))

    # 5. Playwright Settings
    HEADLESS = os.getenv("HEADLESS", "True").lower() in ("true", "1", "yes")
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )

    # 6. Scraping
    XRAY_RESULTS_PER_SEARCH = int(os.getenv("XRAY_RESULTS_PER_SEARCH", "15"))


config = Config()
