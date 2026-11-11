import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AgentError } from "@/lib/agents/runtime/errors";
import { MAX_MESSAGE_CHARS, runChannelTurn } from "@/lib/agents/runtime/service";
import { ipKey, newWidgetToken, WIDGET_KEY, WIDGET_TOKEN, widgetRef } from "@/lib/channels/widget";
import { getPublicEnv } from "@/lib/env";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 120;

const body = z.strictObject({
  key: z.string().regex(WIDGET_KEY),
  token: z.string().regex(WIDGET_TOKEN).nullable(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

const UNAVAILABLE = "The assistant isn't available right now. Please contact the hotel directly.";

/**
 * Public chat endpoint for the embeddable widget (iframe on our own origin).
 * No user session: the business comes from the widget key; the visitor's
 * conversation is bound to a private token (only its hash is stored).
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, getPublicEnv().NEXT_PUBLIC_APP_URL)) return fail("forbidden_origin", "Not allowed.", 403);
  const raw = await request.text();
  if (raw.length > 8_000) return fail("invalid_request", "Message too long.", 413);
  let parsed;
  try {
    parsed = body.safeParse(JSON.parse(raw));
  } catch {
    parsed = null;
  }
  if (!parsed?.success) return fail("invalid_request", `Messages must be between 1 and ${MAX_MESSAGE_CHARS} characters.`, 400);
  const { key, message } = parsed.data;
  if (!process.env.SUPABASE_SECRET_KEY) return fail("unavailable", UNAVAILABLE, 503);

  const admin = createAdminClient();
  const { data: channel } = await admin
    .from("business_channels")
    .select("business_id")
    .eq("public_key", key)
    .eq("kind", "website_widget")
    .eq("enabled", true)
    .maybeSingle();
  if (!channel) return fail("unavailable", UNAVAILABLE, 404);

  const token = parsed.data.token ?? newWidgetToken();
  const ref = widgetRef(token);
  const { data: conv } = await admin
    .from("agent_conversations")
    .select("id")
    .eq("business_id", channel.business_id)
    .eq("channel", "website")
    .eq("external_ref", ref)
    .in("status", ["open", "escalated"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  try {
    const result = await runChannelTurn(
      {
        businessId: channel.business_id,
        agentType: "website_receptionist",
        channel: "website",
        conversationId: conv?.id ?? null,
        externalRef: ref,
        message,
        rateLimits: [
          { key: `widget:ip:${ipKey(request.headers.get("x-forwarded-for"))}`, limit: 15, windowSeconds: 60 },
          { key: `widget:visitor:${ref}`, limit: 10, windowSeconds: 60 },
        ],
        timeoutMs: 60_000,
      },
      { admin },
    );
    return NextResponse.json({ token, reply: result.reply, escalated: result.escalated }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AgentError) {
      if (err.code === "rate_limited") return fail("rate_limited", "Please wait a moment before sending another message.", 429);
      if (err.code === "invalid_request") return fail("invalid_request", err.message, 400);
      // Plan, trial and configuration details are not exposed to the public.
      console.warn("[widget] turn refused", { code: err.code });
      return fail("unavailable", UNAVAILABLE, 503);
    }
    console.error("[widget] unexpected error", { name: err instanceof Error ? err.name : "unknown" });
    return fail("unavailable", UNAVAILABLE, 500);
  }
}
