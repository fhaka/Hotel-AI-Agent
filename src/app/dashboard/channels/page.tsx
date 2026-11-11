import type { Metadata } from "next";
import { regenerateKey, saveVoice, saveWhatsapp, saveWidget } from "@/app/dashboard/channels/actions";
import { EmbedCode, RegenerateKeyForm, VoiceForm, WhatsappForm, WidgetForm } from "@/components/channels/channel-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { readVoiceConfig, readWidgetConfig, VOICE_LANGUAGES } from "@/lib/channels/config";
import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/context";

export const metadata: Metadata = { title: "Channels" };

export default async function ChannelsPage() {
  const { workspace, entitlements: ent } = await getWorkspaceContext("/dashboard/channels");
  const canEdit = ent.can("business.edit");
  if (!canEdit) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <Alert tone="info">Only owners and admins can manage channels.</Alert>
      </div>
    );
  }
  const supabase = await createClient();
  const [{ data: rows }, { data: biz }] = await Promise.all([
    supabase.from("business_channels").select("kind, enabled, public_key, address, config").eq("business_id", workspace.businessId),
    supabase.from("businesses").select("default_language").eq("id", workspace.businessId).single(),
  ]);
  const byKind = (k: string) => (rows ?? []).find((r) => r.kind === k);
  const widget = byKind("website_widget");
  const voice = byKind("voice");
  const whatsapp = byKind("whatsapp");
  const widgetCfg = readWidgetConfig(widget?.config);
  const voiceCfg = readVoiceConfig(voice?.config, biz?.default_language ?? "en");
  const appOrigin = new URL(getPublicEnv().NEXT_PUBLIC_APP_URL).origin;
  const bid = workspace.businessId;
  const voiceDecision = ent.agent("voice_receptionist");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <p className="mt-1 text-sm text-muted">Where guests can talk to your AI agents. All channels use the same knowledge, rules and booking engine.</p>
      </div>

      <Card className="space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Website chat</h2>
          <Badge tone={widget?.enabled ? "success" : "neutral"}>{widget?.enabled ? "Live" : "Off"}</Badge>
        </div>
        <p className="text-sm text-muted">A chat bubble on your website, answered by your Website Receptionist.</p>
        <WidgetForm
          action={saveWidget.bind(null, bid)}
          defaults={{ enabled: widget?.enabled ?? false, origins: widgetCfg.allowed_origins.join("\n"), accentColor: widgetCfg.accent_color ?? "" }}
          readOnly={false}
        />
        {widget?.public_key ? (
          <div className="space-y-3 border-t border-border pt-5">
            <h3 className="text-sm font-semibold">Embed code</h3>
            <p className="text-sm text-muted">Paste this before the closing &lt;/body&gt; tag of every page that should show the chat.</p>
            <EmbedCode snippet={`<script src="${appOrigin}/widget.js" data-key="${widget.public_key}"${widgetCfg.accent_color ? ` data-color="${widgetCfg.accent_color}"` : ""} async></script>`} />
            <RegenerateKeyForm action={regenerateKey.bind(null, bid)} />
          </div>
        ) : null}
      </Card>

      <Card className="space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Phone</h2>
          <Badge tone={voice?.enabled ? "success" : "neutral"}>{voice?.enabled ? "Live" : voice ? "Off" : "Not set up"}</Badge>
        </div>
        {voice?.address ? (
          <>
            <p className="text-sm">
              Your AI phone number: <span className="font-mono font-medium">{voice.address}</span>
            </p>
            {!voiceDecision.allowed ? <Alert tone="warning">{voiceDecision.message}</Alert> : null}
            <VoiceForm
              action={saveVoice.bind(null, bid)}
              defaults={{ enabled: voice.enabled, language: voiceCfg.language, handoffPhone: voiceCfg.handoff_phone ?? "" }}
              languages={VOICE_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
              readOnly={false}
            />
            <p className="text-xs text-muted">
              Callers always hear that they are speaking with an AI assistant. Calls are not recorded; the conversation
              transcript is stored like chat conversations, and staff receive a summary by email after each call.
            </p>
          </>
        ) : (
          <Alert tone="info" title="No phone number yet">
            An AI phone line needs a phone number assigned by HotelAI support and the Business plan (it includes the voice
            minutes). Phone calls are currently available in {VOICE_LANGUAGES.length} languages; Albanian, Croatian and
            Slovenian are not yet supported for speech.
          </Alert>
        )}
      </Card>

      <Card className="space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">WhatsApp</h2>
          <Badge tone={whatsapp?.enabled ? "success" : "neutral"}>{whatsapp?.enabled ? "Live" : whatsapp ? "Off" : "Not set up"}</Badge>
        </div>
        {whatsapp?.address ? (
          <>
            <p className="text-sm">WhatsApp number: <span className="font-mono font-medium">{whatsapp.address}</span></p>
            <WhatsappForm action={saveWhatsapp.bind(null, bid)} enabled={whatsapp.enabled} readOnly={false} />
            <p className="text-xs text-muted">Guests message this number on WhatsApp; your Reservation Assistant answers and can book. Phone numbers are stored only as a non-reversible reference.</p>
          </>
        ) : (
          <Alert tone="info" title="No WhatsApp number yet">
            WhatsApp requires a WhatsApp Business sender approved by Meta and connected by HotelAI support.
          </Alert>
        )}
      </Card>
    </div>
  );
}
