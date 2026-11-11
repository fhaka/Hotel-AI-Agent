import { AgentError } from "@/lib/agents/runtime/errors";
import { runChannelTurn } from "@/lib/agents/runtime/service";
import { readVoiceConfig } from "@/lib/channels/config";
import { findConversation, resolveNumber } from "@/lib/channels/routing";
import { e164From, readTwilioRequest, xml } from "@/lib/channels/twilio";
import { noInputTwiml, replyTwiml, slowTwiml, unavailableTwiml } from "@/lib/channels/voice";
import { appUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

/** Twilio <Gather> result: one caller utterance -> one agent turn -> TwiML. */
export async function POST(request: Request) {
  const { valid, params } = await readTwilioRequest(request);
  if (!valid) return new Response("Forbidden", { status: 403 });
  const to = e164From(params.To);
  const callSid = /^CA[0-9a-f]{32}$/i.test(params.CallSid ?? "") ? params.CallSid : null;
  if (!to || !callSid || !process.env.SUPABASE_SECRET_KEY) return xml(unavailableTwiml());

  const admin = createAdminClient();
  const channel = await resolveNumber(admin, "voice", to);
  if (!channel) return xml(unavailableTwiml());
  const voice = readVoiceConfig(channel.config, channel.defaultLanguage);
  const url = new URL(request.url);
  const empties = Number(url.searchParams.get("empty") ?? "0");
  const action = appUrl("/api/channels/twilio/voice/gather");

  const speech = (params.SpeechResult ?? "").trim().slice(0, 1000);
  if (!speech) {
    return xml(noInputTwiml({ language: voice.language, action: `${action}?empty=${empties + 1}`, final: empties >= 1 }));
  }

  try {
    const result = await runChannelTurn(
      {
        businessId: channel.businessId,
        agentType: "voice_receptionist",
        channel: "voice",
        conversationId: await findConversation(admin, channel.businessId, "voice", callSid, 4),
        externalRef: callSid,
        message: speech,
        rateLimits: [{ key: `voice:call:${callSid}`, limit: 30, windowSeconds: 60 }],
        // Twilio waits ~15 s for a webhook response.
        timeoutMs: 11_000,
      },
      { admin },
    );
    const transferTo = result.escalated && voice.handoff_phone ? { phone: voice.handoff_phone, callerId: to } : null;
    return xml(replyTwiml({ reply: result.reply, language: voice.language, action, transferTo }));
  } catch (err) {
    if (err instanceof AgentError && err.code === "model_timeout") return xml(slowTwiml({ language: voice.language, action }));
    if (!(err instanceof AgentError)) console.error("[voice] unexpected error", { name: err instanceof Error ? err.name : "unknown" });
    else console.warn("[voice] turn refused", { code: err.code });
    return xml(unavailableTwiml(voice.language));
  }
}
