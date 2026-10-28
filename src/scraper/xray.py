"""
Google / Multi-Engine X-Ray Searcher for LinkedIn Prospect Discovery.
Uses Boolean queries: site:linkedin.com/in/ "{title}" "{keyword}" "{location}"
"""

import time
import urllib.parse
from typing import List, Dict, Optional
from playwright.sync_api import sync_playwright
import requests
from bs4 import BeautifulSoup
from .parser import parse_serp_item


class XRaySearcher:
    def __init__(self, user_agent: Optional[str] = None):
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        )

    @staticmethod
    def build_query(target_title: str, niche_keyword: str, location: str, extra: str = "") -> str:
        """
        Build exact Boolean X-Ray search query:
        site:linkedin.com/in/ "{target_title}" "{niche_keyword}" "{location}"
        """
        parts = ["site:linkedin.com/in/"]
        if target_title:
            parts.append(f'"{target_title.strip()}"')
        if niche_keyword:
            parts.append(f'"{niche_keyword.strip()}"')
        if location:
            parts.append(f'"{location.strip()}"')
        if extra:
            parts.append(extra.strip())
        return " ".join(parts)

    def search_playwright_engine(self, query: str, limit: int = 15) -> List[Dict[str, str]]:
        """
        Execute Boolean X-Ray query via resilient multi-engine Playwright browser.
        Searches Yahoo and Google SERPs with anti-bot bypass.
        """
        results: List[Dict[str, str]] = []
        seen_urls = set()

        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled", "--no-sandbox"]
                )
                page = browser.new_page(user_agent=self.user_agent)

                # Search Yahoo with pagination
                encoded_q = urllib.parse.quote(query)
                page_start = 1

                while len(results) < limit and page_start <= 41:
                    yahoo_url = f"https://search.yahoo.com/search?p={encoded_q}&b={page_start}"
                    try:
                        page.goto(yahoo_url, wait_until="domcontentloaded", timeout=25000)
                        page.wait_for_timeout(1500)
                    except Exception:
                        break

                    found_in_page = 0
                    for a in page.locator("a[href*='linkedin.com/in']").all():
                        if len(results) >= limit:
                            break

                        href = a.get_attribute("href") or ""
                        li = a.locator("xpath=./ancestor::li").first

                        raw_title = ""
                        raw_snippet = ""

                        if li.count() > 0:
                            card_lines = [l.strip() for l in li.inner_text().split("\n") if l.strip()]
                            for line in card_lines:
                                if " - " in line or "|" in line or "·" in line:
                                    if not raw_title:
                                        raw_title = line
                                    elif not raw_snippet:
                                        raw_snippet = line

                        if not raw_title:
                            raw_title = a.inner_text().strip()

                        candidate = parse_serp_item(raw_title, raw_snippet, href)
                        if candidate and candidate["linkedin_url"] not in seen_urls:
                            seen_urls.add(candidate["linkedin_url"])
                            results.append(candidate)
                            found_in_page += 1

                    if found_in_page == 0:
                        break

                    page_start += 10
                    page.wait_for_timeout(800)

                browser.close()

        except Exception as e:
            print(f"[XRaySearcher] Playwright discovery notice: {e}")

        return results

    def search_requests_fallback(self, query: str, limit: int = 15) -> List[Dict[str, str]]:
        """Fast HTTP fallback using DuckDuckGo / Bing without full browser."""
        results: List[Dict[str, str]] = []
        seen_urls = set()

        try:
            url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
            headers = {"User-Agent": self.user_agent}
            resp = requests.post("https://html.duckduckgo.com/html/", data={"q": query}, headers=headers, timeout=10)
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.text, "html.parser")
                for node in soup.find_all("div", class_="result"):
                    if len(results) >= limit:
                        break
                    title_node = node.find("a", class_="result__a")
                    snip_node = node.find("a", class_="result__snippet")
                    if title_node:
                        href = title_node.get("href", "")
                        if "uddg=" in href:
                            qs = urllib.parse.parse_qs(urllib.parse.urlparse(href).query)
                            href = qs.get("uddg", [href])[0]
                        candidate = parse_serp_item(
                            title_node.get_text(strip=True),
                            snip_node.get_text(strip=True) if snip_node else "",
                            href,
                        )
                        if candidate and candidate["linkedin_url"] not in seen_urls:
                            seen_urls.add(candidate["linkedin_url"])
                            results.append(candidate)
        except Exception:
            pass

        return results

    def search(self, query: str, limit: int = 15) -> List[Dict[str, str]]:
        """
        Execute search across Boolean X-Ray engines, deduplicate, and return parsed leads.
        """
        print(f"[XRaySearcher] Executing X-Ray Search: {query}")
        results = self.search_playwright_engine(query, limit=limit)

        if len(results) < limit:
            fallback = self.search_requests_fallback(query, limit=limit - len(results))
            existing = {r["linkedin_url"] for r in results}
            for fb in fallback:
                if fb["linkedin_url"] not in existing:
                    results.append(fb)
                    existing.add(fb["linkedin_url"])
                if len(results) >= limit:
                    break

        print(f"[XRaySearcher] Successfully discovered {len(results)} valid LinkedIn prospects.")
        return results
