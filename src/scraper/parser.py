"""
Parser for LinkedIn search results (Google X-Ray / DuckDuckGo SERP).
"""

import re
from typing import Optional, Dict
from ..database.db import normalize_linkedin_url


def clean_prospect_name(raw_name: str) -> str:
    """Clean candidate name by removing credentials, pronouns, and noise."""
    if not raw_name:
        return ""
    name = raw_name.strip()
    # Remove LinkedIn suffixes
    name = re.sub(r"\s*\|\s*LinkedIn.*$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s*-\s*LinkedIn.*$", "", name, flags=re.IGNORECASE)
    # Remove pronouns like (He/Him), [She/Her]
    name = re.sub(r"\s*[\(\[](?:he/him|she/her|they/them)[\)\]]", "", name, flags=re.IGNORECASE)
    # Remove certifications like PhD, MBA, PMP, CPA
    name = re.sub(r",?\s*\b(PHD|MBA|PMP|CSP|CPA|MD|FCA|CA)\b.*$", "", name, flags=re.IGNORECASE)
    # Remove trailing non-alphabetic chars
    name = name.strip(" -–|:·•,")
    return name


def parse_serp_item(raw_title: str, raw_snippet: str, raw_url: str) -> Optional[Dict[str, str]]:
    """
    Parse a search result card into structured prospect data.
    Returns: { "name": ..., "headline": ..., "location": ..., "url": ... } or None if invalid.
    """
    if not raw_url:
        return None

    canonical_url = normalize_linkedin_url(raw_url)
    # Ensure it's a personal profile URL (/in/) and not jobs/posts/pulse/school
    if not canonical_url or "/in/" not in canonical_url:
        return None
    if any(forbidden in canonical_url for forbidden in ["/pulse/", "/jobs/", "/company/", "/posts/", "/groups/"]):
        return None

    # Title parsing
    # Typically: "Firstname Lastname - Current Role - Company | LinkedIn"
    # Or: "Firstname Lastname – Headline | LinkedIn"
    clean_title = re.sub(r"\s*\|\s*LinkedIn.*$", "", raw_title or "", flags=re.IGNORECASE).strip()
    clean_title = re.sub(r"\s*-\s*LinkedIn.*$", "", clean_title, flags=re.IGNORECASE).strip()

    name = ""
    headline = ""

    # Split title on '-' or '–' or '|' or ':'
    parts = [p.strip() for p in re.split(r"[-–|:]", clean_title) if p.strip()]

    if parts:
        name = clean_prospect_name(parts[0])
        if len(parts) > 1:
            # Reconstruct headline from remaining parts
            headline = " - ".join(parts[1:]).strip()

    snippet = (raw_snippet or "").strip()

    # Extract location if available in snippet (e.g. "Nashville Metropolitan Area · ..." or "Pune, Maharashtra, India · ...")
    location = ""
    loc_match = re.search(r"^([^·•|]{2,50}?)\s*[·•|]", snippet)
    if loc_match:
        candidate_loc = loc_match.group(1).strip()
        if not any(kw in candidate_loc.lower() for kw in ("experience", "director", "officer", "founder", "manager")):
            location = candidate_loc

    # If title didn't yield a good headline, use first sentence of snippet
    if not headline and snippet:
        # Strip location prefix
        clean_snippet = re.sub(r"^[A-Za-z\s,]+[·•|-]\s*", "", snippet)
        first_clause = re.split(r"[.·•]", clean_snippet)[0].strip()
        headline = first_clause[:100]

    # Validate extracted prospect
    if not name or len(name) < 2 or name.lower() in ("linkedin", "member", "linkedin member"):
        return None

    return {
        "name": name,
        "headline": headline or "Leader in Industry",
        "location": location,
        "linkedin_url": canonical_url,
    }
