"""
LinkedIn Authentication & Session Manager for Playwright.
Supports li_at cookie injection and persistent storage_state.json.
"""

from pathlib import Path
from typing import Optional
from playwright.sync_api import Browser, BrowserContext, sync_playwright
from ..config import config


def setup_linkedin_session(context: BrowserContext) -> bool:
    """
    Inject li_at cookie or verify existing browser storage state.
    Returns True if session credentials were configured.
    """
    # 1. Option A: Inject li_at cookie from environment
    if config.LINKEDIN_LI_AT and len(config.LINKEDIN_LI_AT) > 10:
        clean_cookie = config.LINKEDIN_LI_AT.strip().strip('"').strip("'")
        cookies = [
            {
                "name": "li_at",
                "value": clean_cookie,
                "domain": ".www.linkedin.com",
                "path": "/",
                "httpOnly": True,
                "secure": True,
                "sameSite": "None",
            },
            {
                "name": "li_at",
                "value": clean_cookie,
                "domain": ".linkedin.com",
                "path": "/",
                "httpOnly": True,
                "secure": True,
                "sameSite": "None",
            },
        ]
        context.add_cookies(cookies)
        return True

    # 2. Option B: Check if storage_state.json exists
    state_file = Path(config.STORAGE_STATE_FILE)
    if state_file.exists():
        return True

    return False


def is_logged_in(page) -> bool:
    """Check if the current browser page is logged into LinkedIn."""
    try:
        url = page.url.lower()
        if any(w in url for w in ["/login", "/authwall", "/checkpoint", "/signup"]):
            return False

        # Look for authenticated elements
        nav_selector = ".global-nav__me, img.global-nav__me-photo, button[aria-label*='Me'], #global-nav"
        if page.locator(nav_selector).count() > 0:
            return True

        # Check for guest/login buttons
        guest_prompt = "a[href*='/login'], a[href*='/signup'], .join-form, .sign-in-card"
        if page.locator(guest_prompt).count() > 0:
            return False

        return True
    except Exception:
        return False


def interactive_login(storage_state_path: Optional[str] = None) -> bool:
    """
    Launch a headed browser for manual login and save storage state.
    """
    state_file = Path(storage_state_path or config.STORAGE_STATE_FILE)
    state_file.parent.mkdir(parents=True, exist_ok=True)

    print("[Auth] Launching headed browser for LinkedIn login...")
    print("[Auth] Please log in manually. The window will detect your session and save it.")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(user_agent=config.USER_AGENT)
        page = context.new_page()
        page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")

        # Wait for login completion
        for _ in range(120):  # 2 minutes timeout
            page.wait_for_timeout(1000)
            if is_logged_in(page) and "/feed" in page.url:
                context.storage_state(path=str(state_file))
                print(f"[Auth] ✅ Login verified! Session state saved to {state_file}")
                browser.close()
                return True

        browser.close()
        print("[Auth] ❌ Login timed out.")
        return False
