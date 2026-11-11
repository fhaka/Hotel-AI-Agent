import { findConversation } from "@/lib/channels/routing";
import { e164From, readTwilioRequest } from "@/lib/channels/twilio";
import { createAdminClient } from "@/lib/supabase/admin";

/** Twilio call status callback: on completion, record minutes and queue the call summary. */
export async function POST(request: Request) {
  const { valid, params } = await readTwilioRequest(request);
  if (!valid) return new Response("Forbidden", { status: 403 });
  if (params.CallStatus !== "completed" || !process.env.SUPABASE_SECRET_KEY) return new Response(null, { status: 204 });
  const to = e164From(params.To);
  const callSid = /^CA[0-9a-f]{32}$/i.test(params.CallSid ?? "") ? params.CallSid : null;
  if (!to || !callSid) return new Response(null, { status: 204 });

  const admin = createAdminClient();
  // Disabled channels still record usage for calls that already happened.
  const { data: channel } = await admin.from("business_channels").select("business_id").eq("kind", "voice").eq("address", to).maybeSingle();
  if (!channel) return new Response(null, { status: 204 });
  const [conversationId, { data: agent }] = await Promise.all([
    findConversation(admin, channel.business_id, "voice", callSid, 24),
    admin.from("agents").select("id").eq("business_id", channel.business_id).eq("agent_type", "voice_receptionist").maybeSingle(),
  ]);
  const { error } = await admin.rpc("record_voice_call", {
    p_business_id: channel.business_id,
    p_conversation_id: conversationId as string,
    p_agent_id: agent?.id as string,
    p_call_sid: callSid,
    p_duration_seconds: Math.max(0, Number.parseInt(params.CallDuration ?? "0", 10) || 0),
  });
  if (error) {
    console.error("[voice] record_voice_call failed", { code: error.code });
    return new Response(null, { status: 500 }); // Twilio retries; recording is idempotent
  }
  return new Response(null, { status: 204 });
}
