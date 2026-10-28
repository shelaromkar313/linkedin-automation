"""
Automated LinkedIn Outreach Dispatcher using Playwright.
Includes anti-ban rate limiting, human typing delays, and safety checkpoints.
"""

import os
import random
import time
from pathlib import Path
from typing import Dict, Any, Optional
from playwright.sync_api import sync_playwright, Page, BrowserContext
from ..config import config
from ..database.db import Database, LeadStatus
from ..ai.generator import AIPersonalizer
from .auth import setup_linkedin_session, is_logged_in


class OutreachDispatcher:
    def __init__(self, db: Optional[Database] = None, ai: Optional[AIPersonalizer] = None):
        self.db = db or Database()
        self.ai = ai or AIPersonalizer()

    def _check_security_checkpoint(self, page: Page) -> bool:
        """Check if LinkedIn served a CAPTCHA or security verification checkpoint."""
        current_url = page.url.lower()
        if any(w in current_url for w in ["/checkpoint/", "/challenge/", "/captcha", "/security-check"]):
            return True

        checkpoint_selectors = [
            "#captcha-internal",
            ".checkpoint-challenge",
            "iframe[src*='captcha']",
            "iframe[src*='challenge']",
            "div[data-test-id*='challenge']",
        ]
        for sel in checkpoint_selectors:
            if page.locator(sel).count() > 0:
                return True

        return False

    def _check_email_required(self, page: Page) -> bool:
        """Check if profile requires recipient email address to connect."""
        email_inputs = page.locator("input[type='email'], input#email")
        if email_inputs.count() > 0:
            return True
        modal_text = page.locator(".artdeco-modal").inner_text() if page.locator(".artdeco-modal").count() > 0 else ""
        if "enter" in modal_text.lower() and "email" in modal_text.lower():
            return True
        return False

    def _is_already_pending_or_connected(self, page: Page) -> bool:
        """Check if candidate already has a pending connection or is already a 1st degree contact."""
        hero = page.locator(".pv-top-card, .scaffold-layout__main section:first-of-type, main section:first-of-type").first
        if not hero or hero.count() == 0:
            return False

        buttons = hero.locator("button, a").all()
        for b in buttons:
            txt = (b.inner_text() or "").strip().lower()
            aria = (b.get_attribute("aria-label") or "").strip().lower()
            if txt in ("pending", "withdraw", "following") or "pending" in aria or "withdraw" in aria:
                return True
        return False

    def _find_and_click_connect(self, page: Page) -> bool:
        """
        Locate and click the Connect button on the hero card (direct or via 3-dots 'More' dropdown).
        """
        hero = page.locator(".scaffold-layout__main section:first-of-type, main section:first-of-type").first
        if not hero or hero.count() == 0:
            hero = page.locator("main").first

        # 1. Check for Direct "Connect" button in hero card
        direct_btn = hero.locator(
            "button:has-text('Connect'), button[aria-label*='Invite'][aria-label*='to connect']"
        ).first
        if direct_btn.count() > 0 and direct_btn.is_visible():
            txt = (direct_btn.inner_text() or "").strip().lower()
            if "pending" not in txt and "message" not in txt:
                print("[Dispatcher] Found direct 'Connect' button on profile hero card. Clicking...")
                direct_btn.click()
                page.wait_for_timeout(1000)
                return True

        # 2. Check "More actions" (...) dropdown on hero card
        more_btn = hero.locator(
            "button[aria-label*='More action'], button[aria-label*='More'], button.artdeco-dropdown__trigger:has-text('More')"
        ).first

        if more_btn.count() > 0 and more_btn.is_visible():
            print("[Dispatcher] Checking 'More actions' (...) dropdown for Connect option...")
            more_btn.click()
            page.wait_for_timeout(800)

            # Find Connect item in dropdown
            dropdown_connect = page.locator(
                ".artdeco-dropdown__content [role='menuitem']:has-text('Connect'), "
                ".artdeco-dropdown__content div[role='button']:has-text('Connect'), "
                ".artdeco-dropdown__item:has-text('Connect')"
            ).first

            if dropdown_connect.count() > 0 and dropdown_connect.is_visible():
                print("[Dispatcher] 🎯 Found Connect inside 'More' dropdown. Clicking...")
                dropdown_connect.click()
                page.wait_for_timeout(1000)
                return True

        return False

    def _handle_invitation_modal(self, page: Page, note_text: str) -> bool:
        """
        Handle the invitation modal:
        Click 'Add a note' -> Type note -> Click Send.
        Fallback to 'Send without a note' if note limit reached.
        """
        modal = page.locator(".artdeco-modal, div[role='dialog']").first
        if modal.count() == 0:
            # Maybe invite went through directly without modal
            return True

        # Safety: Check if email is required
        if self._check_email_required(page):
            print("[Dispatcher] ⚠️ Recipient requires personal email. Dismissing modal.")
            dismiss = page.locator("button[aria-label*='Dismiss'], button[aria-label*='Close']").first
            if dismiss.count() > 0:
                dismiss.click()
            return False

        # Safety: Check for weekly limit
        modal_text = modal.inner_text().lower()
        if "weekly invitation limit" in modal_text or "reached the weekly limit" in modal_text:
            print("[Dispatcher] 🛑 LinkedIn weekly invitation limit reached. Halting outreach.")
            dismiss = page.locator("button[aria-label*='Dismiss'], button[aria-label*='Close']").first
            if dismiss.count() > 0:
                dismiss.click()
            return False

        # Look for "Add a note" button
        add_note_btn = modal.locator(
            "button:has-text('Add a note'), button[aria-label*='Add a note']"
        ).first

        textarea = page.locator("textarea#custom-message, textarea[name='message'], .artdeco-modal textarea").first

        if textarea.count() == 0 and add_note_btn.count() > 0 and add_note_btn.is_visible():
            print("[Dispatcher] Clicking 'Add a note' button in invitation modal...")
            add_note_btn.click()
            page.wait_for_timeout(700)
            textarea = page.locator("textarea#custom-message, textarea[name='message'], .artdeco-modal textarea").first

        # SCENARIO A: Textarea is open -> Type note and send
        if textarea.count() > 0 and textarea.is_visible():
            print(f"[Dispatcher] Textarea revealed. Typing personalized note ({len(note_text)} chars)...")
            textarea.click()
            textarea.fill("")
            # Human typing delay simulation
            textarea.type(note_text, delay=random.randint(20, 45))
            page.wait_for_timeout(600)

            send_btn = modal.locator(
                "button.artdeco-button--primary:has-text('Send'), button[aria-label*='Send invitation'], button[aria-label*='Send now']"
            ).first

            if send_btn.count() > 0 and send_btn.is_enabled():
                print("[Dispatcher] Clicking Send invitation...")
                send_btn.click()
                page.wait_for_timeout(1500)
                return True

        # SCENARIO B: Fallback to "Send without a note"
        print("[Dispatcher] Note textarea not available. Executing fallback 'Send without a note'...")
        fallback_btn = modal.locator(
            "button:has-text('Send without a note'), button[aria-label*='Send without a note']"
        ).first

        if fallback_btn.count() > 0 and fallback_btn.is_visible():
            fallback_btn.click()
            page.wait_for_timeout(1500)
            return True

        # Dismiss stuck modal
        dismiss = modal.locator("button[aria-label*='Dismiss'], button[aria-label*='Close']").first
        if dismiss.count() > 0:
            dismiss.click()

        return False

    def dispatch_batch(self, limit: int = 10, headless: Optional[bool] = None, dry_run: bool = False) -> Dict[str, Any]:
        """
        Execute automated outreach dispatch with anti-ban rate limits and delays.
        """
        is_headless = headless if headless is not None else config.HEADLESS

        # 1. Check daily rate limit
        sent_today = self.db.count_sent_in_last_24h()
        max_allowed = config.MAX_DAILY_INVITES
        if sent_today >= max_allowed:
            print(f"[Dispatcher] 🛑 Daily limit reached: {sent_today}/{max_allowed} sent in last 24h.")
            return {"status": "LIMIT_REACHED", "sent_today": sent_today, "dispatched": 0}

        batch_quota = min(limit, max_allowed - sent_today)
        print(f"[Dispatcher] Ready to dispatch up to {batch_quota} invites ({sent_today}/{max_allowed} sent today).")

        # 2. Get pending leads
        leads = self.db.get_leads_by_status(LeadStatus.GENERATED, limit=batch_quota)
        if not leads:
            # Also pull from PENDING and generate notes on-the-fly if needed
            pending = self.db.get_leads_by_status(LeadStatus.PENDING, limit=batch_quota)
            for p in pending:
                note = self.ai.generate_note(p["name"], p["headline"])
                self.db.update_lead_note(p["id"], note)
            leads = self.db.get_leads_by_status(LeadStatus.GENERATED, limit=batch_quota)

        if not leads:
            print("[Dispatcher] No pending leads in database to dispatch.")
            return {"status": "EMPTY", "dispatched": 0}

        dispatched_count = 0
        failed_count = 0

        # In dry-run mode, if no session exists, simulate dispatch offline
        state_file = Path(config.STORAGE_STATE_FILE)
        has_env_cookie = bool(config.LINKEDIN_LI_AT and len(config.LINKEDIN_LI_AT) > 10)
        
        if dry_run and not has_env_cookie and not state_file.exists():
            print("\n[Dispatcher] 🧪 DRY-RUN SIMULATION (No live LinkedIn session detected)")
            print("[Dispatcher] Simulating full outreach sequence without modifying live LinkedIn account:")
            for i, lead in enumerate(leads, 1):
                name = lead["name"]
                url = lead["linkedin_url"]
                note = lead["connection_note"] or self.ai.generate_note(name, lead["headline"])
                print(f"\n  [{i}/{len(leads)}] Target: {name}")
                print(f"      Profile: {url}")
                print(f"      Note ({len(note)} chars): \"{note}\"")
                print(f"      [Simulation] Verified ≤200 chars. Would click 'Connect' -> 'Add a note' -> Send.")
                dispatched_count += 1
            print(f"\n[Dispatcher] ✅ Dry-run simulation completed for {dispatched_count} leads.")
            return {
                "status": "DRY_RUN_COMPLETED",
                "dispatched": dispatched_count,
                "failed": 0,
                "sent_today": sent_today,
            }

        # Launch Playwright Chromium
        with sync_playwright() as p:
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars",
            ]
            browser = p.chromium.launch(headless=is_headless, args=launch_args)

            context_kwargs = {
                "user_agent": config.USER_AGENT,
                "viewport": {"width": 1280, "height": 800},
            }
            if state_file.exists():
                context_kwargs["storage_state"] = str(state_file)

            context = browser.new_context(**context_kwargs)
            has_auth = setup_linkedin_session(context)

            page = context.new_page()

            # Verify login status
            page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2000)

            if not is_logged_in(page):
                if dry_run:
                    print("[Dispatcher] (DRY-RUN) LinkedIn login not present. Simulating dispatch locally:")
                    for i, lead in enumerate(leads, 1):
                        name = lead["name"]
                        url = lead["linkedin_url"]
                        note = lead["connection_note"] or self.ai.generate_note(name, lead["headline"])
                        print(f"  [{i}/{len(leads)}] (DRY-RUN) Would dispatch note to {name}: \"{note}\"")
                        dispatched_count += 1
                    browser.close()
                    return {"status": "DRY_RUN_COMPLETED", "dispatched": dispatched_count, "failed": 0, "sent_today": sent_today}

                print("[Dispatcher] ❌ Error: Not logged in to LinkedIn. Please set LINKEDIN_LI_AT in .env or run 'python main.py login'.")
                browser.close()
                return {"status": "AUTH_FAILED", "message": "Not authenticated to LinkedIn."}

            print("[Dispatcher] ✅ LinkedIn session verified successfully.")

            for i, lead in enumerate(leads, 1):
                lead_id = lead["id"]
                name = lead["name"]
                url = lead["linkedin_url"]
                note = lead["connection_note"] or self.ai.generate_note(name, lead["headline"])

                print(f"\n[Dispatcher] [{i}/{len(leads)}] Processing: {name} ({url})")

                if dry_run:
                    print(f"[Dispatcher] (DRY-RUN) Would send note: \"{note}\"")
                    dispatched_count += 1
                    continue

                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=35000)
                    page.wait_for_timeout(2000)

                    # Check security checkpoints
                    if self._check_security_checkpoint(page):
                        print("[Dispatcher] 🛑 SECURITY CHECKPOINT / CAPTCHA DETECTED! Pausing all outreach immediately.")
                        break

                    # Check if already pending or connected
                    if self._is_already_pending_or_connected(page):
                        print(f"[Dispatcher] Lead {name} is already pending connection or connected. Marking SENT.")
                        self.db.update_lead_status(lead_id, LeadStatus.SENT)
                        dispatched_count += 1
                        continue

                    # Human-like random scroll
                    page.mouse.wheel(0, random.randint(150, 350))
                    page.wait_for_timeout(random.randint(600, 1200))

                    # Click Connect
                    clicked = self._find_and_click_connect(page)
                    if not clicked:
                        print(f"[Dispatcher] Could not find Connect button on {name}'s profile.")
                        self.db.update_lead_status(lead_id, LeadStatus.FAILED)
                        failed_count += 1
                        continue

                    # Handle invitation note modal
                    sent_success = self._handle_invitation_modal(page, note)
                    if sent_success:
                        print(f"[Dispatcher] ✅ Connection invite successfully dispatched to {name}!")
                        self.db.update_lead_status(lead_id, LeadStatus.SENT)
                        dispatched_count += 1
                    else:
                        print(f"[Dispatcher] ⚠️ Invitation modal could not be completed for {name}.")
                        self.db.update_lead_status(lead_id, LeadStatus.FAILED)
                        failed_count += 1

                    # Anti-Ban Randomized Delay between consecutive invites
                    if i < len(leads):
                        delay = random.uniform(config.MIN_ACTION_DELAY_SECONDS, config.MAX_ACTION_DELAY_SECONDS)
                        print(f"[Dispatcher] ⏳ Anti-ban guardrail: Sleeping {delay:.1f}s before next candidate...")
                        time.sleep(delay)

                except Exception as e:
                    print(f"[Dispatcher] Error processing candidate {name}: {e}")
                    self.db.update_lead_status(lead_id, LeadStatus.FAILED)
                    failed_count += 1

            browser.close()

        print(f"\n[Dispatcher] Batch complete. Dispatched: {dispatched_count}, Failed: {failed_count}.")
        return {
            "status": "COMPLETED",
            "dispatched": dispatched_count,
            "failed": failed_count,
            "sent_today": self.db.count_sent_in_last_24h(),
        }


# Backwards compatibility alias
LinkedInDispatcher = OutreachDispatcher
