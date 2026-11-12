import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getPublicEnv } from "@/lib/env";

/**
 * Uptime check for monitors (e.g. Better Stack, UptimeRobot, Vercel checks).
 * 200 when the app and database answer, 503 otherwise. Reveals nothing about
 * configuration.
 */
export async function GET() {
  const started = Date.now();
  let database: "ok" | "error" = "error";
  try {
    const env = getPublicEnv();
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(3000) }) },
    });
    const { data, error } = await supabase.rpc("health_check");
    database = !error && data === true ? "ok" : "error";
  } catch {
    database = "error";
  }
  const ok = database === "ok";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", database, latency_ms: Date.now() - started },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
