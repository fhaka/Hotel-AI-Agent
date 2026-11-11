import "server-only";
import { createHmac } from "node:crypto";
import twilio from "twilio";
import { appUrl } from "@/lib/env";

/**
 * Twilio webhook helpers (official `twilio` SDK v6; API verified against its
 * type definitions).
 *
 * Authenticity: X-Twilio-Signature is validated with the SDK against the
 * CANONICAL public URL (NEXT_PUBLIC_APP_URL + path + query), never the Host
 * header, using TWILIO_AUTH_TOKEN.
 */
export function twilioConfigured(): boolean {
  return Boolean(process.env.TWILIO_AUTH_TOKEN);
}

export async function readTwilioRequest(request: Request): Promise<{ valid: boolean; params: Record<string, string> }> {
  const raw = await request.text();
  if (raw.length > 64_000) return { valid: false, params: {} };
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("x-twilio-signature");
  if (!token || !signature) return { valid: false, params };
  const url = new URL(request.url);
  const canonical = appUrl(`${url.pathname}${url.search}`);
  let valid = false;
  try {
    valid = twilio.validateRequest(token, signature, canonical, params);
  } catch {
    valid = false;
  }
  return { valid, params };
}

/** "whatsapp:+3556..." / "+3556..." -> "+3556..." (E.164) or null. */
export function e164From(value: string | undefined): string | null {
  const v = (value ?? "").replace(/^whatsapp:/, "").trim();
  return /^\+[1-9][0-9]{6,14}$/.test(v) ? v : null;
}

/**
 * Stable, non-reversible reference for a phone number (WhatsApp sender), so
 * conversations can be continued without storing the raw number. Keyed with
 * the Twilio auth token (server secret).
 */
export function phoneRef(e164: string): string {
  return "ph_" + createHmac("sha256", process.env.TWILIO_AUTH_TOKEN ?? "").update(e164).digest("hex").slice(0, 40);
}

export function xml(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
}

export const VoiceResponse = twilio.twiml.VoiceResponse;
export const MessagingResponse = twilio.twiml.MessagingResponse;
