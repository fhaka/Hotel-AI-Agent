import { NextResponse, type NextRequest } from "next/server";
import { runScheduledJobs } from "@/lib/automation/worker";
import { hasValidBearer } from "@/lib/security/bearer";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Scheduled jobs: reminders, reports, alerts, retries, retention.
 * Call every 5–15 minutes from any scheduler (Vercel Cron, n8n, cron+curl)
 * with `Authorization: Bearer $CRON_SECRET`. GET is supported because some
 * schedulers (e.g. Vercel Cron) only send GET requests.
 */
async function handle(request: NextRequest) {
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) {
    return NextResponse.json({ error: "jobs_not_configured" }, { status: 503 });
  }
  if (!hasValidBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: "jobs_not_configured" }, { status: 503 });
  const result = await runScheduledJobs({ admin: createAdminClient() });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
