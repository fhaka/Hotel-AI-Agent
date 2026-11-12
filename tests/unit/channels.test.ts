import twilio from "twilio";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defaultVoiceLanguage, readVoiceConfig, voiceConfigSchema, widgetConfigSchema } from "@/lib/channels/config";
import { greetingTwiml, noInputTwiml, replyTwiml, unavailableTwiml } from "@/lib/channels/voice";
import { ipKey, safeOrigins, widgetRef } from "@/lib/channels/widget";

vi.mock("server-only", () => ({}));

const APP = "https://app.hotelai.example";
const TOKEN = "twilio_auth_token_for_tests_000000";

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = APP;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_value_1234";
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
});

function twilioRequest(path: string, params: Record<string, string>, signedUrl = `${APP}${path}`, requestHost = "http://internal:3000") {
  const signature = twilio.getExpectedTwilioSignature(TOKEN, signedUrl, params);
  return new Request(`${requestHost}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature },
    body: new URLSearchParams(params).toString(),
  });
}

describe("Twilio request verification (real SDK)", () => {
  const params = { CallSid: "CA" + "a".repeat(32), To: "+355690000002", From: "+4915112345678", SpeechResult: "Do you have parking?" };

  it("accepts requests signed for the canonical public URL, regardless of the internal Host", async () => {
    const { readTwilioRequest } = await import("@/lib/channels/twilio");
    const res = await readTwilioRequest(twilioRequest("/api/channels/twilio/voice/gather?empty=1", params));
    expect(res.valid).toBe(true);
    expect(res.params.SpeechResult).toBe("Do you have parking?");
  });

  it("rejects tampered parameters, other URLs, missing or wrong signatures", async () => {
    const { readTwilioRequest } = await import("@/lib/channels/twilio");
    const tampered = twilioRequest("/api/channels/twilio/voice/gather", params);
    const body = new URLSearchParams({ ...params, To: "+355690000999" }).toString();
    expect((await readTwilioRequest(new Request(tampered.url, { method: "POST", headers: tampered.headers, body }))).valid).toBe(false);
    expect((await readTwilioRequest(twilioRequest("/api/channels/twilio/voice", params, "https://evil.example/api/channels/twilio/voice"))).valid).toBe(false);
    expect((await readTwilioRequest(new Request(`${APP}/api/channels/twilio/voice`, { method: "POST", body: new URLSearchParams(params).toString() }))).valid).toBe(false);
  });

  it("phone references are stable and never contain the number", async () => {
    const { e164From, phoneRef } = await import("@/lib/channels/twilio");
    expect(e164From("whatsapp:+4915112345678")).toBe("+4915112345678");
    expect(e164From("015112345678")).toBeNull();
    const ref = phoneRef("+4915112345678");
    expect(ref).toBe(phoneRef("+4915112345678"));
    expect(ref).not.toContain("4915112345678");
    expect(ref).toMatch(/^ph_[0-9a-f]{40}$/);
  });
});

describe("TwiML", () => {
  const action = `${APP}/api/channels/twilio/voice/gather`;

  it("greets with the AI disclosure and gathers speech in the configured language", () => {
    const x = greetingTwiml({ businessName: "Hotel Adriatik", greeting: null, language: "de-DE", action });
    expect(x).toContain('<Gather input="speech" language="de-DE" speechTimeout="auto"');
    expect(x).toContain(`action="${action}"`);
    expect(x).toContain("Hallo, Sie sind verbunden mit Hotel Adriatik.");
    expect(x).toContain("Ich bin ein KI-Assistent.");
    expect(x).toContain("nicht aufgezeichnet"); // callers hear that the call is transcribed, not recorded
  });

  it("keeps the disclosure with a custom greeting", () => {
    expect(greetingTwiml({ businessName: "H", greeting: "Welcome to Villa Rosa!", language: "en-GB", action })).toContain("Welcome to Villa Rosa! I'm an AI assistant.");
  });

  it("escapes model output so it can never inject TwiML", () => {
    const x = replyTwiml({ reply: 'Sure</Say><Dial>+19005550000</Dial><Say>& "done"', language: "en-GB", action });
    expect(x).not.toContain("<Dial>");
    expect(x).toContain("&lt;/Say&gt;&lt;Dial&gt;");
    expect(x.match(/<Dial/g)).toBeNull();
  });

  it("transfers to staff with the business number as caller id when a hand-over happened", () => {
    const x = replyTwiml({ reply: "I'll pass this on.", language: "en-GB", action, transferTo: { phone: "+355691111111", callerId: "+355690000002" } });
    expect(x).toContain('<Dial timeout="25" callerId="+355690000002">+355691111111</Dial>');
    expect(x).toContain("<Hangup/>");
  });

  it("reprompts once on silence, then says goodbye", () => {
    expect(noInputTwiml({ language: "en-GB", action, final: false })).toContain("<Gather");
    const bye = noInputTwiml({ language: "en-GB", action, final: true });
    expect(bye).toContain("Goodbye");
    expect(bye).toContain("<Hangup/>");
    expect(unavailableTwiml("it-IT")).toContain("non è disponibile");
  });
});

describe("widget helpers", () => {
  it("only allows strict origins in the CSP header", () => {
    const origins = safeOrigins(["https://www.hotel.example", "https://a.example; script-src *", "javascript:alert(1)", "https://b.example:8443", 42]);
    expect(origins).toEqual(["https://www.hotel.example", "https://b.example:8443"]);
  });
  it("hashes visitor tokens and IPs", () => {
    expect(widgetRef("a".repeat(48))).toMatch(/^wt_[0-9a-f]{40}$/);
    expect(ipKey("203.0.113.9, 10.0.0.1")).toBe(ipKey("203.0.113.9"));
    expect(ipKey("203.0.113.9")).not.toContain("203.0.113.9");
  });
});

describe("channel settings", () => {
  it("validates widget origins and colours", () => {
    expect(widgetConfigSchema.parse({ allowed_origins: ["https://www.hotel.example/"], accent_color: "#112233" })).toEqual({ allowed_origins: ["https://www.hotel.example"], accent_color: "#112233" });
    expect(widgetConfigSchema.safeParse({ allowed_origins: ["http://hotel.example"] }).success).toBe(false);
    expect(widgetConfigSchema.safeParse({ allowed_origins: ["https://hotel.example/page"] }).success).toBe(false);
    expect(widgetConfigSchema.safeParse({ allowed_origins: [], accent_color: "red" }).success).toBe(false);
  });
  it("offers only languages Twilio can hear and speak, and maps the business language", () => {
    expect(voiceConfigSchema.safeParse({ language: "sq-AL", handoff_phone: null }).success).toBe(false);
    expect(voiceConfigSchema.safeParse({ language: "de-DE", handoff_phone: "+49301234567" }).success).toBe(true);
    expect(defaultVoiceLanguage("it")).toBe("it-IT");
    expect(defaultVoiceLanguage("sq")).toBeNull();
    expect(readVoiceConfig(null, "sq")).toEqual({ language: "en-GB", handoff_phone: null });
  });
});
