import { checkAgentExecution } from "@/lib/entitlements/evaluate";
import { entitlementSnapshotSchema } from "@/lib/entitlements/snapshot";
import { readVoiceConfig } from "@/lib/channels/config";
import { resolveNumber } from "@/lib/channels/routing";
import { e164From, readTwilioRequest, xml } from "@/lib/channels/twilio";
import { greetingTwiml, unavailableTwiml } from "@/lib/channels/voice";
import { appUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/** Twilio "A call comes in" webhook for numbers assigned to businesses. */
export async function POST(request: Request) {
  const { valid, params } = await readTwilioRequest(request);
  if (!valid) return new Response("Forbidden", { status: 403 });
  const to = e164From(params.To);
  if (!to || !process.env.SUPABASE_SECRET_KEY) return xml(unavailableTwiml());

  const admin = createAdminClient();
  const channel = await resolveNumber(admin, "voice", to);
  if (!channel) return xml(unavailableTwiml());
  const voice = readVoiceConfig(channel.config, channel.defaultLanguage);

  // Don't greet callers if the agent can't actually run (plan, trial, limits, disabled).
  const [{ data: snapshot }, { data: agent }] = await Promise.all([
    admin.rpc("get_business_entitlements_service", { p_business_id: channel.businessId }),
    admin.from("agents").select("system_configuration").eq("business_id", channel.businessId).eq("agent_type", "voice_receptionist").maybeSingle(),
  ]);
  const parsed = entitlementSnapshotSchema.safeParse(snapshot);
  if (!parsed.success || !checkAgentExecution(parsed.data, "voice_receptionist", { requireRole: false }).allowed) {
    return xml(unavailableTwiml(voice.language));
  }
  const greeting = (agent?.system_configuration as { greeting?: string } | null)?.greeting ?? null;
  return xml(greetingTwiml({ businessName: channel.businessName, greeting, language: voice.language, action: appUrl("/api/channels/twilio/voice/gather") }));
}
