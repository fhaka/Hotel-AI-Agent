import { AgentError } from "@/lib/agents/runtime/errors";
import { runChannelTurn } from "@/lib/agents/runtime/service";
import { findConversation, resolveNumber } from "@/lib/channels/routing";
import { e164From, MessagingResponse, phoneRef, readTwilioRequest, xml } from "@/lib/channels/twilio";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

const UNAVAILABLE = "Sorry, this assistant isn't available right now. Please contact us directly.";

function reply(text: string): Response {
  const r = new MessagingResponse();
  r.message(text.slice(0, 1500));
  return xml(r.toString());
}

/** Twilio WhatsApp inbound message webhook. */
export async function POST(request: Request) {
  const { valid, params } = await readTwilioRequest(request);
  if (!valid) return new Response("Forbidden", { status: 403 });
  const to = e164From(params.To);
  const from = e164From(params.From);
  if (!to || !from || !process.env.SUPABASE_SECRET_KEY) return reply(UNAVAILABLE);
  const body = (params.Body ?? "").trim();
  if (!body) return reply("I can only read text messages. Please type your question.");

  const admin = createAdminClient();
  const channel = await resolveNumber(admin, "whatsapp", to);
  if (!channel) return reply(UNAVAILABLE);
  const ref = phoneRef(from); // the raw number is not stored

  try {
    const result = await runChannelTurn(
      {
        businessId: channel.businessId,
        agentType: "reservation_assistant",
        channel: "whatsapp",
        conversationId: await findConversation(admin, channel.businessId, "whatsapp", ref, 24),
        externalRef: ref,
        message: body.slice(0, 2000),
        rateLimits: [{ key: `whatsapp:sender:${ref}`, limit: 10, windowSeconds: 60 }],
        timeoutMs: 12_000,
      },
      { admin },
    );
    return reply(result.reply);
  } catch (err) {
    if (err instanceof AgentError && err.code === "rate_limited") return reply("Please wait a moment before sending another message.");
    if (err instanceof AgentError && err.code === "model_timeout") return reply("Sorry, that took too long. Could you send your message again?");
    console.warn("[whatsapp] turn refused", { code: err instanceof AgentError ? err.code : "unexpected" });
    return reply(UNAVAILABLE);
  }
}
