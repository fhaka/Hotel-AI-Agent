/**
 * Server error reporting. Every unhandled server error (render, route handler,
 * server action, proxy) becomes one JSON log line that hosting log search
 * and log drains can index, and is optionally forwarded to ERROR_WEBHOOK_URL
 * (any HTTPS endpoint that accepts JSON, e.g. a Slack/Teams incoming webhook
 * or an alerting service). No request bodies, headers or query strings are
 * included; token-like path segments are redacted.
 */
export type ErrorReport = {
  level: "error";
  event: "server_error";
  time: string;
  message: string;
  name: string;
  digest?: string;
  method: string;
  path: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
  deployment?: string;
};

type RequestInfo = { path: string; method: string };
type ContextInfo = { routePath?: string; routeType?: string; renderSource?: string };

/** Drops the query string and redacts long opaque segments (invite tokens, keys). */
export function redactPath(path: string): string {
  const pathname = path.split(/[?#]/)[0] ?? "/";
  return pathname
    .split("/")
    .map((seg) => (/^[A-Za-z0-9_\-]{24,}$/.test(seg) && !/^[0-9a-f-]{36}$/i.test(seg) ? ":redacted" : seg))
    .join("/");
}

export function buildErrorReport(err: unknown, request: RequestInfo, context: ContextInfo, now = new Date()): ErrorReport {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Non-error thrown");
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  return {
    level: "error",
    event: "server_error",
    time: now.toISOString(),
    // Messages are truncated; they can contain user input in rare cases.
    message: e.message.slice(0, 500),
    name: e.name,
    digest,
    method: request.method,
    path: redactPath(request.path),
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? process.env.DEPLOYMENT_ID,
  };
}

// Per-instance throttle so an error storm can't flood the alert channel.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
let windowStart = 0;
let sentInWindow = 0;

export function shouldForward(now: number): boolean {
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    sentInWindow = 0;
  }
  sentInWindow += 1;
  return sentInWindow <= MAX_PER_WINDOW;
}

export async function reportServerError(report: ErrorReport, deps: { webhookUrl?: string; fetch?: typeof fetch; now?: number } = {}) {
  console.error(JSON.stringify(report));
  const url = deps.webhookUrl ?? process.env.ERROR_WEBHOOK_URL;
  if (!url || !url.startsWith("https://") || !shouldForward(deps.now ?? Date.now())) return;
  try {
    await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` makes the same payload readable in Slack-style incoming webhooks.
      body: JSON.stringify({ text: `HotelAI server error: ${report.message} (${report.routeType ?? "?"} ${report.path}, digest ${report.digest ?? "—"})`, report }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Never let reporting break a request.
  }
}
