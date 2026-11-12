/**
 * Content Security Policy built per request in src/proxy.ts.
 *
 * Scripts: inline scripts only with this request's nonce (Next.js adds it to
 * the scripts it streams at request time) or a known hash; script files only
 * from our own origin and Paddle's CDN. 'strict-dynamic' is not used because
 * the prerendered page shell references our script files without a nonce.
 * `npm run check:csp` verifies this against a running server.
 * Styles allow 'unsafe-inline': React style attributes and the Paddle overlay
 * need it, and style injection cannot run code. Documented in ADR 0012.
 */
export type CspOptions = {
  nonce: string;
  dev: boolean;
  /** Sources allowed to frame the page; empty means none at all. */
  frameAncestors: string[];
  supabaseUrl: string;
};

/**
 * Inline scripts that React writes into prerendered HTML (no nonce there).
 * React's paint-timing snippet, from react-dom/server. If a React upgrade
 * changes it, `npm run check:csp` fails and prints the new hash.
 */
export const INLINE_SCRIPT_HASHES = ["'sha256-7mu4H06fwDCjmnxxr/xNHyuQC6pLTHr4M2E4jXw5WZs='"];

const PADDLE = ["https://cdn.paddle.com", "https://buy.paddle.com", "https://sandbox-buy.paddle.com"];

export function buildCsp(o: CspOptions): string {
  const supabase = originOf(o.supabaseUrl);
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", `'nonce-${o.nonce}'`, ...INLINE_SCRIPT_HASHES, "https://cdn.paddle.com", ...(o.dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'", "https://cdn.paddle.com"]],
    ["img-src", ["'self'", "data:", "blob:", "https://cdn.paddle.com"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...(supabase ? [supabase, supabase.replace(/^https:/, "wss:")] : []), "https://*.paddle.com", ...(o.dev ? ["ws:"] : [])]],
    ["frame-src", PADDLE],
    ["worker-src", ["'self'", "blob:"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", o.frameAncestors.length ? o.frameAncestors : ["'none'"]],
  ];
  const parts = directives.map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!o.dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** 128-bit random nonce, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}
