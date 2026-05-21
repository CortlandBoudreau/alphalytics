export type ApiError =
  | { kind: "rate_limit"; retryAfter: number }
  | { kind: "not_found";  detail: string }
  | { kind: "server";     detail: string }
  | { kind: "network";    detail: string }
  | { kind: "building" }   // 202 — data is being built server-side, poll again

export type ApiResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: ApiError }

export async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, options)

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "60", 10)
      return { ok: false, error: { kind: "rate_limit", retryAfter: isNaN(retryAfter) ? 60 : retryAfter } }
    }

    if (res.status === 202) {
      return { ok: false, error: { kind: "building" } }
    }

    let body: Record<string, string> = {}
    try { body = await res.json() } catch { /* non-JSON body */ }

    if (res.status === 404) {
      return { ok: false, error: { kind: "not_found", detail: body.detail || "Not found" } }
    }

    if (!res.ok) {
      return { ok: false, error: { kind: "server", detail: body.detail || `Server error (${res.status})` } }
    }

    return { ok: true, data: body as T }
  } catch {
    return { ok: false, error: { kind: "network", detail: "Cannot connect to server. Is the backend running?" } }
  }
}

/** Human-readable label for an ApiError */
export function apiErrorMessage(err: ApiError): string {
  switch (err.kind) {
    case "rate_limit": return `Rate limited — retry in ${err.retryAfter}s`
    case "not_found":  return err.detail
    case "server":     return err.detail
    case "network":    return err.detail
    case "building":   return "Building screener data…"
  }
}
