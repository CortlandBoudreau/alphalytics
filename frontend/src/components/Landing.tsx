import { CanvasBackground } from "@/components/CanvasBackground"

type Props = {
  onEnter: () => void
}

export function Landing({ onEnter }: Props) {
  const s: Record<string, React.CSSProperties> = {
    root: {
      position: "relative",
      minHeight: "100vh",
      background: "#080a0f",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'system-ui', sans-serif",
    },
    nav: {
      position: "relative",
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "24px 48px",
      maxWidth: 1200,
      margin: "0 auto",
      width: "100%",
    },
    launchBtn: {
      background: "none",
      border: "none",
      color: "#60a5fa",
      fontSize: 15,
      fontWeight: 500,
      cursor: "pointer",
      letterSpacing: 0.3,
    },
    hero: {
      position: "relative",
      zIndex: 10,
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "60px 24px 80px",
    },
    eyebrow: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 14px",
      borderRadius: 999,
      border: "1px solid rgba(59,130,246,0.25)",
      background: "rgba(59,130,246,0.06)",
      color: "#60a5fa",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      marginBottom: 36,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: "#3b82f6",
    },
    h1: {
      fontSize: "clamp(64px, 10vw, 120px)",
      fontWeight: 900,
      lineHeight: 1,
      letterSpacing: "-0.03em",
      color: "#fff",
      marginBottom: 8,
      fontFamily: "Georgia, serif",
    },
    h1Blue: {
      background: "linear-gradient(90deg, #3b82f6, #93c5fd)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
    },
    sub: {
      fontSize: 18,
      color: "#6b7280",
      maxWidth: 560,
      lineHeight: 1.7,
      marginBottom: 48,
      marginTop: 20,
    },
    cta: {
      padding: "16px 48px",
      borderRadius: 10,
      background: "linear-gradient(135deg, #2563eb, #3b82f6)",
      color: "#fff",
      fontWeight: 700,
      fontSize: 18,
      border: "none",
      cursor: "pointer",
      letterSpacing: 0.3,
      transition: "transform 0.2s",
    },
    fine: {
      fontSize: 12,
      color: "#374151",
      marginTop: 16,
    },
    cards: {
      position: "relative",
      zIndex: 10,
      maxWidth: 1100,
      margin: "0 auto",
      width: "100%",
      padding: "0 32px 80px",
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 16,
    },
    card: {
      padding: "28px 24px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.05)",
      background: "rgba(255,255,255,0.02)",
      transition: "background 0.2s, border-color 0.2s",
    },
    iconBox: {
      width: 44,
      height: 44,
      borderRadius: 10,
      background: "rgba(59,130,246,0.08)",
      border: "1px solid rgba(59,130,246,0.18)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 18,
    },
    cardTitle: {
      color: "#fff",
      fontWeight: 700,
      fontSize: 18,
      marginBottom: 10,
    },
    cardText: {
      color: "#6b7280",
      fontSize: 14,
      lineHeight: 1.7,
    },
  }

  return (
    <div style={s.root}>
      <CanvasBackground />

      {/* Nav */}
      <nav style={s.nav}>
        <img src="/logo.svg" alt="Alphalytics" style={{ height: 32 }} />
        <button style={s.launchBtn} onClick={onEnter}>Launch App →</button>
      </nav>

      {/* Hero */}
      <div style={s.hero}>
        <div style={s.eyebrow}>
          <span style={s.dot} />
          AI-Powered Stock Research
        </div>

        <h1 style={s.h1}>
          Know the<br />
          <span style={s.h1Blue}>Alpha.</span>
        </h1>

        <p style={s.sub}>
          Deep income statement analysis, multi-stock comparison, and AI-generated bull/bear breakdowns — built for investors who read the numbers.
        </p>

        <button
          style={s.cta}
          onClick={onEnter}
          onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
          onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
        >
          Get Started
        </button>
        <p style={s.fine}>No account required. Free to use.</p>
      </div>

      {/* Feature Cards */}
      <div style={s.cards}>
        {[
          {
            title: "Income Statements",
            desc: "Last 4 quarters of full P&L with YoY growth rates. AI grades each quarter A–F based on revenue growth, margin expansion, and expense discipline.",
            icon: (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path d="M3 16L8 10L11 13L15 7L19 10" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19 7H15V10" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )
          },
          {
            title: "Stock Compare",
            desc: "Side-by-side comparison of up to 3 stocks across valuation, growth, margins, and price metrics. Spot winners and laggards instantly.",
            icon: (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="6" width="5" height="13" rx="1.5" stroke="#3b82f6" strokeWidth="1.8"/>
                <rect x="8.5" y="3" width="5" height="16" rx="1.5" stroke="#3b82f6" strokeWidth="1.8"/>
                <rect x="15" y="8" width="5" height="11" rx="1.5" stroke="#3b82f6" strokeWidth="1.8"/>
              </svg>
            )
          },
          {
            title: "AI Analysis",
            desc: "Claude-powered bull and bear case breakdowns with sentiment scoring. Institutional-quality analysis on any ticker in seconds.",
            icon: (
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="8" stroke="#3b82f6" strokeWidth="1.8"/>
                <path d="M8 11C8 9.34 9.34 8 11 8C12.66 8 14 9.34 14 11C14 12.66 12.66 14 11 14" stroke="#3b82f6" strokeWidth="1.8" strokeLinecap="round"/>
                <circle cx="11" cy="11" r="1.5" fill="#3b82f6"/>
              </svg>
            )
          },
        ].map((card) => (
          <div
            key={card.title}
            style={s.card}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)"
              ;(e.currentTarget as HTMLDivElement).style.borderColor = "rgba(59,130,246,0.2)"
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)"
              ;(e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.05)"
            }}
          >
            <div style={s.iconBox}>{card.icon}</div>
            <div style={s.cardTitle}>{card.title}</div>
            <div style={s.cardText}>{card.desc}</div>
          </div>
        ))}
      </div>

      {/* Bottom fade */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 120,
        background: "linear-gradient(to top, #080a0f, transparent)",
        pointerEvents: "none",
      }} />
    </div>
  )
}
