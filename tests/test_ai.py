"""
Unit tests for AI Personalization Agent, strict 200-char limits, and quality constraints.
"""

import pytest
from src.ai.generator import AIPersonalizer


def test_character_constraint_strict_hard_limit():
    """Verify that generated notes strictly NEVER exceed 200 characters."""
    ai = AIPersonalizer(provider="template")

    prospects = [
        ("David Donatelli", "Executive Vice President and General Manager at Oracle Enterprise Cloud Systems"),
        ("Abraham Regan", "President and Chief Technical Architect at Global IT Systems and Telecommunications Infrastructure Corp"),
        ("Anje Kruger", "Founder & Managing Director - Scaling Emerging Market Enterprise SaaS Startups Across Africa"),
        ("Peter Day", "Chief Executive Officer at Optimize to Convert"),
        ("Jane", "Lead"),
    ]

    for name, headline in prospects:
        note = ai.generate_note(name, headline)
        assert len(note) <= 200, f"Note exceeds 200 chars ({len(note)}): '{note}'"
        assert len(note) > 10, f"Note too short: '{note}'"


def test_no_robotic_or_generic_intros():
    """Verify that robotic phrases and placeholders are completely absent."""
    ai = AIPersonalizer(provider="template")
    note = ai.generate_note("Revanth Dasoji", "CEO at American IT Systems")

    forbidden_phrases = [
        "i came across your profile",
        "hope this finds you well",
        "hope you are doing well",
        "[your name]",
        "[company]",
        "dear sir",
    ]

    lower_note = note.lower()
    for phrase in forbidden_phrases:
        assert phrase not in lower_note, f"Forbidden phrase '{phrase}' found in note: '{note}'"


def test_clean_and_truncate_enforcement():
    """Verify truncate logic safely trims oversized text to a clean sentence under 200 chars."""
    ai = AIPersonalizer(provider="template")
    oversized = (
        "Hi Alex, your trajectory in AI infrastructure is truly remarkable and speaks to visionary leadership. "
        "We are actively pioneering distributed high-performance edge compute platforms and would love to exchange perspectives on modern stack architecture."
    )
    assert len(oversized) > 200

    truncated = ai._clean_and_truncate(oversized, "Alex", "AI Infrastructure")
    assert len(truncated) <= 200
    assert truncated.endswith(".")
