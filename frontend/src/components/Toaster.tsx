import { useToasts } from "@/lib/toast"

const ICONS = {
  success: "✓",
  error:   "✕",
  info:    "ℹ",
}

const COLORS = {
  success: "border-green-500/40 bg-green-500/10 text-green-400",
  error:   "border-red-500/40 bg-red-500/10 text-red-400",
  info:    "border-blue-500/40 bg-blue-500/10 text-blue-400",
}

export function Toaster() {
  const toasts = useToasts()

  if (!toasts.length) return null

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm font-medium shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-2 fade-in duration-200 ${COLORS[t.type]}`}
        >
          <span className="text-xs">{ICONS[t.type]}</span>
          {t.message}
        </div>
      ))}
    </div>
  )
}
