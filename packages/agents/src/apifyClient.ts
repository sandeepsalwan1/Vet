// General-purpose Apify runtime client.
// Any agent or tool can run any Apify actor through runApifyActor — it is not
// tied to pricing or any single use case. Designed to never throw: it returns
// null on misconfiguration, timeout, or actor failure so callers can fall back
// to deterministic mock data and emit an observable fallback event.

const APIFY_BASE_URL = "https://api.apify.com/v2";

/** A general public web-search actor; the default when no specific actor is configured. */
export const DEFAULT_SEARCH_ACTOR = "apify/google-search-scraper";

/**
 * Resolve the Apify token from env. Prefers APIFY_API_TOKEN (read by the app),
 * falls back to APIFY_TOKEN (read by the Apify CLI). Ignores unexpanded
 * "${...}" placeholders that can leak in from shell-style .env files.
 */
function resolveApifyToken(): string | null {
  for (const value of [process.env.APIFY_API_TOKEN, process.env.APIFY_TOKEN]) {
    const token = value?.trim();
    if (token && !token.startsWith("${")) return token;
  }
  return null;
}

export function apifyConfigured(): boolean {
  return resolveApifyToken() !== null;
}

type ApifyRunOptions = {
  /** Client-side abort in ms (default 60s). */
  timeoutMs?: number;
  /** Max dataset items to return. */
  limit?: number;
};

/**
 * Run an Apify actor synchronously and return its dataset items.
 * `actorId` accepts either "username/actor" or "username~actor".
 * Returns null on any failure so callers can fall back safely.
 */
export async function runApifyActor<T = Record<string, unknown>>(
  actorId: string,
  input: Record<string, unknown>,
  options: ApifyRunOptions = {}
): Promise<T[] | null> {
  const token = resolveApifyToken();
  if (!token) return null;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const actorTimeoutSecs = Math.max(10, Math.floor(timeoutMs / 1000));
  const slug = encodeURIComponent(actorId.replace("/", "~"));
  const params = new URLSearchParams({ timeout: String(actorTimeoutSecs) });
  if (options.limit) params.set("limit", String(options.limit));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `${APIFY_BASE_URL}/acts/${slug}/run-sync-get-dataset-items?${params.toString()}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input),
        signal: controller.signal
      }
    );
    if (!response.ok) return null;
    const rows = await response.json().catch(() => null);
    return Array.isArray(rows) ? (rows as T[]) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
