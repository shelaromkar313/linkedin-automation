"""
AI Personalization Agent for LinkedIn Connection Requests.
Strict hard limit: Maximum 200 characters including spaces.
Supports Groq, Ollama, OpenRouter, Gemini, and intelligent offline template fallback.
"""

import re
from typing import Optional
from openai import OpenAI
from ..config import config


class AIPersonalizer:
    MAX_CHAR_LIMIT = 200

    def __init__(
        self,
        provider: Optional[str] = None,
        api_key: Optional[str] = None,
        pitch: Optional[str] = None,
    ):
        self.provider = (provider or config.LLM_PROVIDER).lower()
        self.pitch = pitch or config.BUSINESS_PITCH
        self.api_key = api_key or self._resolve_api_key()
        self.client = self._init_client()

    def _resolve_api_key(self) -> str:
        if self.provider == "groq":
            return config.GROQ_API_KEY
        if self.provider == "gemini":
            return config.GEMINI_API_KEY
        if self.provider == "openrouter":
            return config.OPENROUTER_API_KEY
        if self.provider == "ollama":
            return "ollama"  # Ollama doesn't require a real API key
        return ""

    def _init_client(self) -> Optional[OpenAI]:
        """Initialize OpenAI-compatible client based on provider."""
        try:
            if self.provider == "groq" and self.api_key:
                return OpenAI(
                    base_url="https://api.groq.com/openai/v1",
                    api_key=self.api_key,
                )
            if self.provider == "ollama":
                return OpenAI(
                    base_url=config.OLLAMA_BASE_URL,
                    api_key="ollama",
                )
            if self.provider == "openrouter" and self.api_key:
                return OpenAI(
                    base_url="https://openrouter.ai/api/v1",
                    api_key=self.api_key,
                )
            if self.provider == "gemini" and self.api_key:
                # Gemini OpenAI compatibility endpoint
                return OpenAI(
                    base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
                    api_key=self.api_key,
                )
        except Exception as e:
            print(f"[AIPersonalizer] Client initialization notice: {e}")
        return None

    def _clean_and_truncate(self, raw_note: str, first_name: str, headline: str) -> str:
        """Enforce strict clean formatting and <= 200 characters limit."""
        if not raw_note:
            return self._generate_template_note(first_name, headline)

        # Remove system preambles, notes, quotes, and brackets
        text = re.sub(r"^(?:Note|Here is a note|Message|Subject):?\s*", "", raw_note, flags=re.IGNORECASE)
        text = re.sub(r"\[(?:Your Name|My Name|Name|Company)\]", "", text, flags=re.IGNORECASE)
        text = text.replace('"', "").replace("'", "").replace("`", "").strip()
        text = re.sub(r"\s+", " ", text)

        # Strict limit enforcement (<= 200 characters)
        if len(text) <= self.MAX_CHAR_LIMIT:
            return text

        # Truncate at the last clean sentence before limit
        truncated = text[: self.MAX_CHAR_LIMIT - 1]
        last_punct = max(truncated.rfind("."), truncated.rfind("!"), truncated.rfind("?"))
        if last_punct > 80:
            return truncated[: last_punct + 1].strip()

        # Fallback to smart word boundary trim
        last_space = truncated.rfind(" ")
        if last_space > 80:
            return truncated[:last_space].strip() + "."

        return truncated.strip()

    def _generate_template_note(self, first_name: str, headline: str) -> str:
        """
        High-performing, non-robotic fallback note strictly under 200 characters.
        Does not use robotic intros like 'I came across your profile'.
        """
        clean_headline = re.sub(r"\s+", " ", headline or "your industry").strip()
        # Extract primary role from headline
        role = clean_headline.split("-")[0].split("|")[0].split(" at ")[0].strip()
        role = role[:40]

        templates = [
            f"Hi {first_name}, impressed by your leadership as {role}. Would love to connect and exchange perspectives on scaling industry tech!",
            f"Hi {first_name}, noticed your work in {role}. Would value connecting to follow your initiatives and share tech insights.",
            f"Hi {first_name}, great seeing your trajectory in {role}. Would love to connect and stay in touch regarding industry innovation!",
        ]

        # Return first template that fits comfortably under 200 chars
        for t in templates:
            if len(t) <= self.MAX_CHAR_LIMIT:
                return t

        return f"Hi {first_name}, saw your impressive work in {role[:30]}. Would love to connect and exchange tech insights!"[:self.MAX_CHAR_LIMIT]

    def generate_note(self, full_name: str, headline: str) -> str:
        """
        Generate a personalized connection request note strictly under 200 chars.
        """
        first_name = (full_name or "there").strip().split(" ")[0]
        clean_headline = (headline or "technology leadership").strip()

        # If no client or template provider selected, use template
        if not self.client or self.provider == "template":
            return self._generate_template_note(first_name, clean_headline)

        prompt = (
            f"Draft a personalized 1-sentence LinkedIn connection request note for {first_name}.\n"
            f"Prospect Headline: {clean_headline}\n"
            f"Sender Context: {self.pitch}\n"
            f"STRICT RULES:\n"
            f"1. MAXIMUM 180 CHARACTERS TOTAL. Never exceed 200 characters.\n"
            f"2. Natural and conversational peer-to-peer tone.\n"
            f"3. Do NOT pitch or sell.\n"
            f"4. Never say 'I came across your profile' or 'Hope this finds you well'.\n"
            f"5. Output ONLY the note text, without quotes or greeting placeholders."
        )

        model = "llama-3.3-70b-versatile" if self.provider == "groq" else config.OLLAMA_MODEL
        if self.provider == "openrouter":
            model = "meta-llama/llama-3.1-8b-instruct:free"

        try:
            response = self.client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=65,
                temperature=0.6,
            )
            raw_content = response.choices[0].message.content or ""
            return self._clean_and_truncate(raw_content, first_name, clean_headline)
        except Exception as e:
            print(f"[AIPersonalizer] LLM API call error ({e}). Using intelligent template fallback.")
            return self._generate_template_note(first_name, clean_headline)
