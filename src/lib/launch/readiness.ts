/**
 * Production configuration check. Pure and dependency-free so it runs both in
 * the admin area and from the command line (`npm run check:env`). It reports
 * only whether a value is present and plausible — never the value itself.
 */
export type ReadinessCheck = {
  id: string;
  area: "core" | "ai" | "email" | "billing" | "jobs" | "channels" | "legal";
  required: boolean;
  ok: boolean;
  message: string;
};

type Env = Record<string, string | undefined>;

const has = (env: Env, key: string, min = 1) => (env[key]?.trim().length ?? 0) >= min;

function httpsUrl(value: string | undefined): boolean {
  try {
    const u = new URL(value ?? "");
    return u.protocol === "https:" && !["localhost", "127.0.0.1"].includes(u.hostname);
  } catch {
    return false;
  }
}

const PRICE_KEYS = ["BASIC", "GROWTH", "BUSINESS"].flatMap((p) => [`PADDLE_PRICE_${p}_MONTHLY`, `PADDLE_PRICE_${p}_YEARLY`]);

export function assessLaunchReadiness(env: Env): ReadinessCheck[] {
  const c = (id: string, area: ReadinessCheck["area"], required: boolean, ok: boolean, message: string): ReadinessCheck => ({ id, area, required, ok, message });
  const missingPrices = PRICE_KEYS.filter((k) => !has(env, k));
  return [
    c("app_url", "core", true, httpsUrl(env.NEXT_PUBLIC_APP_URL), "NEXT_PUBLIC_APP_URL is the public https address (used in emails, webhooks and Twilio signatures)."),
    c("supabase_url", "core", true, httpsUrl(env.NEXT_PUBLIC_SUPABASE_URL), "NEXT_PUBLIC_SUPABASE_URL points to your Supabase project (https)."),
    c("supabase_publishable", "core", true, has(env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", 20), "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is set."),
    c("supabase_secret", "core", true, has(env, "SUPABASE_SECRET_KEY", 20), "SUPABASE_SECRET_KEY is set (server only)."),
    c("openai_key", "ai", true, has(env, "OPENAI_API_KEY", 20), "OPENAI_API_KEY is set."),
    c("openai_model", "ai", true, has(env, "OPENAI_MODEL"), "OPENAI_MODEL names a model your OpenAI account can use."),
    c("resend_key", "email", true, has(env, "RESEND_API_KEY", 10), "RESEND_API_KEY is set."),
    c("resend_from", "email", true, /@/.test(env.RESEND_FROM_EMAIL ?? ""), "RESEND_FROM_EMAIL uses your verified sending domain."),
    c("cron_secret", "jobs", true, has(env, "CRON_SECRET", 32), "CRON_SECRET is at least 32 characters and a scheduler calls /api/jobs/run."),
    c("paddle_api", "billing", true, has(env, "PADDLE_API_KEY", 10) && has(env, "PADDLE_WEBHOOK_SECRET", 10), "PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET are set."),
    c("paddle_client", "billing", true, has(env, "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", 10), "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is set."),
    c("paddle_prices", "billing", true, missingPrices.length === 0, missingPrices.length ? `Price IDs missing: ${missingPrices.join(", ")}.` : "All six Paddle price IDs are set."),
    c("paddle_live", "billing", true, env.PADDLE_ENVIRONMENT === "production", "PADDLE_ENVIRONMENT is 'production' (sandbox takes no real payments)."),
    c("twilio", "channels", false, has(env, "TWILIO_AUTH_TOKEN", 16), "TWILIO_AUTH_TOKEN is set (only needed for phone and WhatsApp)."),
    c("company_name", "legal", true, has(env, "NEXT_PUBLIC_COMPANY_NAME", 2), "NEXT_PUBLIC_COMPANY_NAME (the legal entity shown in the privacy notice and terms)."),
    c("company_address", "legal", true, has(env, "NEXT_PUBLIC_COMPANY_ADDRESS", 5), "NEXT_PUBLIC_COMPANY_ADDRESS (registered address shown in the legal pages)."),
    c("support_email", "legal", true, /@/.test(env.NEXT_PUBLIC_SUPPORT_EMAIL ?? ""), "NEXT_PUBLIC_SUPPORT_EMAIL (contact for customers and privacy requests)."),
  ];
}

export function readinessSummary(checks: ReadinessCheck[]) {
  const blocking = checks.filter((x) => x.required && !x.ok);
  return { ready: blocking.length === 0, blocking: blocking.length, warnings: checks.filter((x) => !x.required && !x.ok).length };
}
