import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { safeOrigins, WIDGET_KEY } from "@/lib/channels/widget";
import { getPublicEnv } from "@/lib/env";
import { buildCsp, newNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const env = getPublicEnv();
  const nonce = newNonce();
  // The chat widget may only be framed by the business's allowed websites;
  // every other page may not be framed at all.
  const ancestors = pathname.startsWith("/widget/") ? ["'self'", ...(await widgetOrigins(pathname.split("/")[2] ?? ""))] : [];
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    frameAncestors: ancestors,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
  });
  // Next.js reads the nonce from the request's CSP header and adds it to its scripts.
  const response = await updateSession(request, { "x-nonce": nonce, "content-security-policy": csp });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

async function widgetOrigins(key: string): Promise<string[]> {
  if (!WIDGET_KEY.test(key)) return [];
  try {
    const env = getPublicEnv();
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(3000) }) },
    });
    const { data } = await supabase.rpc("widget_public_config", { p_key: key });
    const cfg = data as { enabled?: boolean; allowed_origins?: unknown } | null;
    return cfg?.enabled ? safeOrigins(cfg.allowed_origins) : [];
  } catch {
    return []; // fail closed: only same-origin framing
  }
}

export const config = {
  matcher: [
    // Pages and server actions. Static assets, image optimisation, the
    // favicon and machine endpoints (signature/secret authenticated) are excluded.
    "/((?!_next/static|_next/image|favicon.ico|widget.js|api/billing/webhook|api/jobs|api/channels|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
