"""
Unit tests for Google X-Ray search query builder and SERP parser.
"""

import pytest
from src.scraper.xray import XRaySearcher
from src.scraper.parser import parse_serp_item, clean_prospect_name
from src.database.db import normalize_linkedin_url


def test_build_xray_query():
    """Verify Boolean X-Ray query format."""
    query = XRaySearcher.build_query(
        target_title="Chief Executive Officer",
        niche_keyword="SaaS",
        location="Pune",
    )
    assert query == 'site:linkedin.com/in/ "Chief Executive Officer" "SaaS" "Pune"'


def test_build_xray_query_with_extra():
    """Verify extra filters in Boolean query."""
    query = XRaySearcher.build_query(
        target_title="Founder",
        niche_keyword="Fintech",
        location="Mumbai",
        extra='"Series A"',
    )
    assert query == 'site:linkedin.com/in/ "Founder" "Fintech" "Mumbai" "Series A"'


def test_clean_prospect_name():
    """Verify name cleaning removes certifications and noise."""
    assert clean_prospect_name("Revanth Dasoji | LinkedIn") == "Revanth Dasoji"
    assert clean_prospect_name("Dr. Abraham Regan PHD, MBA, CSP (He/Him)") == "Dr. Abraham Regan"
    assert clean_prospect_name("Peter Day - LinkedIn") == "Peter Day"


def test_parse_serp_item_standard():
    """Verify parsing standard search result card."""
    raw_title = "Revanth Dasoji - Chief Executive Officer - American IT Systems | LinkedIn"
    raw_snippet = "Nashville Metropolitan Area · Chief Executive Officer (CEO) · American IT Systems. Experienced executive..."
    raw_url = "https://www.linkedin.com/in/revanth-dasoji-5870322a/?originalSubdomain=in"

    lead = parse_serp_item(raw_title, raw_snippet, raw_url)
    assert lead is not None
    assert lead["name"] == "Revanth Dasoji"
    assert "Chief Executive Officer" in lead["headline"]
    assert lead["linkedin_url"] == "https://www.linkedin.com/in/revanth-dasoji-5870322a/"
    assert "Nashville" in lead["location"]


def test_parse_serp_item_rejects_non_profile_urls():
    """Verify company, pulse, job, and group links are rejected."""
    assert parse_serp_item("Acme Corp | LinkedIn", "Company page", "https://linkedin.com/company/acme") is None
    assert parse_serp_item("Engineering Lead Jobs | LinkedIn", "Job listing", "https://linkedin.com/jobs/view/123") is None
    assert parse_serp_item("Article on AI | LinkedIn", "Pulse article", "https://linkedin.com/pulse/ai-insights") is None


def test_normalize_linkedin_url():
    """Verify URL canonicalization."""
    raw = "https://in.linkedin.com/in/john-doe-123/?trackingId=abc#section"
    canonical = normalize_linkedin_url(raw)
    assert canonical == "https://www.linkedin.com/in/john-doe-123/"
