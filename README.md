<p align="center">
  <strong>AI-powered stock research platform</strong><br/>
  Income statement grading, multi-stock comparison, and Claude-powered bull/bear analysis.
</p>

<p align="center">
  🔗 <a href="https://alphalytics-theta.vercel.app"><strong>alphalytics-theta.vercel.app</strong></a>
</p>

---

![Landing](screenshots/landing.png)

---

## Features

### 📊 Income Statement Analysis
- Last 4 quarters of full P&L data with year-over-year growth rates
- AI grades each quarter **A–F** based on revenue growth, margin expansion, and expense discipline
- Overall grade with flags for one-time items, tax anomalies, and unusual patterns
- Bullish / bearish / neutral sentiment per ticker

![Income](screenshots/income.png)

### ⚖️ Stock Compare
- Side-by-side comparison of up to 3 stocks
- Grouped metrics: Valuation, Growth, Margins, 52-Week Range
- YoY growth indicators per metric

![Compare](screenshots/compare.png)

### 🔍 Stock Research
- Search 10,000+ tickers with live autocomplete
- Price, market cap, P/E, Forward P/E, P/S, gross margin, net margin, EPS growth, revenue growth
- 1-year price chart and quarterly revenue chart
- Claude-powered bull case / bear case breakdown on demand

---

## Tech Stack

**Frontend**
- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- Recharts
- Deployed on **Vercel**

**Backend**
- FastAPI (Python)
- yfinance — market data
- Anthropic Claude API (claude-haiku-4-5) — AI analysis + income grading
- Redis — caching (tickers 24hr, stock data 15min, analysis 1hr)
- slowapi — rate limiting
- Deployed on **Railway**

---

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────┐
│  React Frontend  │ ──────▶ │  FastAPI Backend  │ ──────▶ │   yfinance  │
│   (Vercel)       │         │  (Railway)        │         │   Yahoo API │
└─────────────────┘         └──────────────────┘         └─────────────┘
                                      │
                              ┌───────┴───────┐
                              │               │
                         ┌────▼────┐   ┌──────▼──────┐
                         │  Redis  │   │  Anthropic  │
                         │  Cache  │   │  Claude API │
                         └─────────┘   └─────────────┘
```

---

## Local Development

### Prerequisites
- Python 3.13+
- Node 24+
- Redis running on `localhost:6379`

### Backend

```bash
cd backend
pip install -r requirements.txt
```

Create `.env.development`:
```
ENV=development
API_SECRET_TOKEN=your_token
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-haiku-4-5
```

```bash
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
```

Create `.env.development`:
```
VITE_API_URL=http://127.0.0.1:8000
VITE_API_SECRET_TOKEN=your_token
```

```bash
npm run dev
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/stock/{ticker}` | Stock data + chart data |
| GET | `/income/{ticker}` | Quarterly income statements + AI grading |
| POST | `/analyze` | AI bull/bear analysis |
| GET | `/tickers` | All tickers for autocomplete |

All endpoints require Bearer token authentication.

---

## Security

- Bearer token authentication on all endpoints
- Rate limiting via slowapi (5–10 req/min per endpoint)
- Prompt injection protection on AI endpoints
- All secrets in environment variables, never in code