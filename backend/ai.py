from pydantic import BaseModel
import anthropic
import json
import os

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


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
