"""
Bot module for automated Playwright browser outreach and dispatch.
"""

from .auth import setup_linkedin_session
from .dispatcher import OutreachDispatcher

__all__ = ["setup_linkedin_session", "OutreachDispatcher"]
