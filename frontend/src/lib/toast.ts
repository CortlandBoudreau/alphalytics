import { useState, useEffect } from "react"

export type ToastItem = {
  id: string
  message: string
  type: "success" | "error" | "info"
}

type Listener = (toasts: ToastItem[]) => void

let _toasts: ToastItem[] = []
let _listeners: Listener[] = []
let _counter = 0

function notify() {
  _listeners.forEach(l => l([..._toasts]))
}

function dismiss(id: string) {
  _toasts = _toasts.filter(t => t.id !== id)
  notify()
}

export function toast(message: string, type: ToastItem["type"] = "success") {
  const id = String(++_counter)
  _toasts = [..._toasts, { id, message, type }]
  notify()
  setTimeout(() => dismiss(id), 3000)
}

export function useToasts(): ToastItem[] {
  const [items, setItems] = useState<ToastItem[]>(_toasts)
  useEffect(() => {
    _listeners.push(setItems)
    return () => { _listeners = _listeners.filter(l => l !== setItems) }
  }, [])
  return items
}
