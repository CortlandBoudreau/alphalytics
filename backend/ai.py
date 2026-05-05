from pydantic import BaseModel
import anthropic
import json
import logging
import os
import re

logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def sanitize_for_prompt(value: str, max_length: int = 300) -> str:
    """Sanitize a string for safe inclusion in an LLM prompt.

    Strips control characters (newlines, tabs, nulls) that could be used
    for prompt injection, collapses whitespace, and truncates.
    """
    if not isinstance(value, str):
        value = str(value)
    # Replace all control characters (including \n, \r, \t) with a space
    value = re.sub(r"[\x00-\x1f\x7f]", " ", value)
    # Collapse multiple spaces
    value = re.sub(r" {2,}", " ", value).strip()
    return value[:max_length]


class AnalysisRequest(BaseModel):
    ticker: str
    name: str
    price: float
    change: float
    marketCap: str
    peRatio: str | float | None
    forwardPE: float | None
    weekHigh52: float
    weekLow52: float
    sector: str
    description: str
    ttmEpsGrowth: float | None
    ttmRevenueGrowth: float | None
    grossMargin: float | None
    netMargin: float | None
    ttmPsRatio: float | None


def call_claude(prompt: str, max_tokens: int = 512) -> dict:
    message = client.messages.create(
        model=os.getenv("ANTHROPIC_MODEL", "claude-haiku-4-5"),
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1]
    if raw.endswith("```"):
        raw = raw.rsplit("```", 1)[0]
    return json.loads(raw.strip())
