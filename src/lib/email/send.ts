import "server-only";
import { Resend } from "resend";

/**
 * Transactional email via Resend (official SDK, API verified against its
 * bundled type definitions). Never throws: callers get an explicit result and
 * must tell the user honestly when an email was not sent.
 */
export type SendResult =
  | { status: "sent"; id: string }
  | { status: "not_configured" }
  | { status: "failed"; retryable: boolean; code: string };

const TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 2;

let client: Resend | null = null;

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key => Resend sends at most once, so retries are safe. */
  idempotencyKey: string;
  tags?: { name: string; value: string }[];
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { status: "not_configured" };
  client ??= new Resend(apiKey);

  let last: SendResult = { status: "failed", retryable: true, code: "unknown" };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await withTimeout(
        client.emails.send(
          { from, to: input.to, subject: input.subject, html: input.html, text: input.text, tags: input.tags },
          { idempotencyKey: input.idempotencyKey },
        ),
        TIMEOUT_MS,
      );
      if (result.data) return { status: "sent", id: result.data.id };
      const status = result.error?.statusCode ?? null;
      const retryable = status === null || status === 429 || status >= 500;
      last = { status: "failed", retryable, code: result.error?.name ?? "unknown" };
      // Log the error class only — never recipients or content.
      console.error("[email] send failed", { code: last.code, status, attempt });
      if (!retryable) return last;
    } catch (err) {
      last = { status: "failed", retryable: true, code: err instanceof TimeoutError ? "timeout" : "network_error" };
      console.error("[email] send error", { code: last.code, attempt });
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
  return last;
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
