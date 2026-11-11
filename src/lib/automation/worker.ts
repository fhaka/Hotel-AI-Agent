import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, type SendResult } from "@/lib/email/send";
import type { Database } from "@/lib/supabase/database.types";
import { renderNotification, type NotificationRow, type RenderResult } from "./render";

type Admin = SupabaseClient<Database>;

export type JobStats = {
  expiredTrials: number | null;
  enqueued: Record<string, number> | null;
  notifications: { sent: number; retry: number; failed: number; skipped: number };
  purgedConversations: number | null;
  errors: string[];
};

/**
 * One scheduled run. Every step is isolated: a failing step is recorded and
 * the others still run. Safe to call concurrently and repeatedly: enqueueing
 * is deduplicated in SQL, claiming uses SKIP LOCKED, and each email carries
 * the notification id as idempotency key.
 */
export async function runScheduledJobs(deps: {
  admin: Admin;
  send?: typeof sendEmail;
  render?: (admin: Admin, n: NotificationRow) => Promise<RenderResult>;
  batchSize?: number;
  maxBatches?: number;
  deadlineMs?: number;
}): Promise<{ status: "ok" | "partial"; stats: JobStats }> {
  const { admin } = deps;
  const send = deps.send ?? sendEmail;
  const render = deps.render ?? renderNotification;
  const started = Date.now();
  const deadline = started + (deps.deadlineMs ?? 50_000);
  const stats: JobStats = {
    expiredTrials: null,
    enqueued: null,
    notifications: { sent: 0, retry: 0, failed: 0, skipped: 0 },
    purgedConversations: null,
    errors: [],
  };

  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      stats.errors.push(`${name}: ${err instanceof Error ? err.message.slice(0, 200) : "failed"}`);
      return null;
    }
  };
  const rpc = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error } = await (admin.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: T; error: { code?: string; message: string } | null }>)(fn, args);
    if (error) throw new Error(`${fn} failed (${error.code ?? "?"})`);
    return data;
  };

  stats.expiredTrials = await step("expire_trials", () => rpc<number>("expire_trials"));
  stats.enqueued = await step("enqueue", () => rpc<Record<string, number>>("enqueue_due_notifications"));

  for (let batch = 0; batch < (deps.maxBatches ?? 8) && Date.now() < deadline; batch++) {
    const claimed = await step("claim", () => rpc<NotificationRow[]>("claim_notifications", { p_limit: deps.batchSize ?? 25 }));
    if (!claimed?.length) break;
    for (const n of claimed) {
      let outcome: "sent" | "retry" | "failed" | "skipped";
      let error: string | null = null;
      let providerId: string | null = null;
      try {
        const rendered = await render(admin, n);
        if (rendered.action === "skip") {
          outcome = "skipped";
          error = rendered.reason;
        } else {
          const result: SendResult = await send({
            to: n.recipient_email,
            ...rendered.email,
            idempotencyKey: `notification:${n.id}`,
            tags: [{ name: "type", value: n.kind }],
          });
          if (result.status === "sent") {
            outcome = "sent";
            providerId = result.id;
          } else if (result.status === "not_configured") {
            outcome = "skipped";
            error = "email_not_configured";
          } else {
            outcome = result.retryable ? "retry" : "failed";
            error = result.code;
          }
        }
      } catch (err) {
        outcome = "retry";
        error = `render_error: ${err instanceof Error ? err.message.slice(0, 150) : "unknown"}`;
      }
      stats.notifications[outcome] += 1;
      await step("complete", () =>
        rpc("complete_notification", { p_id: n.id, p_outcome: outcome, p_error: error, p_provider_message_id: providerId }),
      );
    }
  }

  stats.purgedConversations = await step("purge", () => rpc<number>("purge_expired_conversations"));
  const status = stats.errors.length ? "partial" : "ok";
  await step("record", () =>
    rpc("record_job_run", {
      p_job: "scheduled",
      p_started_at: new Date(started).toISOString(),
      p_status: status,
      p_stats: stats,
      p_error: stats.errors.join("; ") || null,
    }),
  );
  return { status, stats };
}
