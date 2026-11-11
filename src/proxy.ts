import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { frameAncestors, safeOrigins, WIDGET_KEY } from "@/lib/channels/widget";
import { getPublicEnv } from "@/lib/env";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/widget/")) {
    // The chat widget may only be framed by the business's allowed websites.
    // The browser enforces this via CSP frame-ancestors.
    response.headers.set("Content-Security-Policy", frameAncestors(await widgetOrigins(pathname.split("/")[2] ?? "")));
  }
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
    // Run on everything except static assets, image optimisation and the
    // favicon. Webhook routes are excluded: they authenticate by signature.
    "/((?!_next/static|_next/image|favicon.ico|api/billing/webhook|api/jobs|api/channels|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
