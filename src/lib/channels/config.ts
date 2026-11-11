import type VoiceResponse from "twilio/lib/twiml/VoiceResponse";
import { z } from "zod";

// The SDK keeps its language unions internal; derive them from the TwiML
// method signatures instead (gather(attributes), say(attributes, message)).
type GatherLanguage = NonNullable<NonNullable<Parameters<VoiceResponse["gather"]>[0]>["language"]>;
type SayLanguage = NonNullable<Parameters<VoiceResponse["say"]>[0] extends infer A ? (A extends { language?: infer L } ? L : never) : never>;

/**
 * Voice languages offered to businesses: only those Twilio can both
 * recognise (<Gather>) AND speak (<Say>). Checked at compile time against the
 * official SDK's unions. Albanian, Croatian and Slovenian are recognised but
 * have no built-in voice, so they are not offered for phone calls.
 */
type Both = GatherLanguage & SayLanguage;

export const VOICE_LANGUAGES = [
  { code: "en-GB", label: "English (UK)", lang: "en" },
  { code: "en-US", label: "English (US)", lang: "en" },
  { code: "de-DE", label: "German", lang: "de" },
  { code: "fr-FR", label: "French", lang: "fr" },
  { code: "it-IT", label: "Italian", lang: "it" },
  { code: "es-ES", label: "Spanish", lang: "es" },
  { code: "pt-PT", label: "Portuguese", lang: "pt" },
  { code: "nl-NL", label: "Dutch", lang: "nl" },
  { code: "el-GR", label: "Greek", lang: "el" },
  { code: "pl-PL", label: "Polish", lang: "pl" },
  { code: "ro-RO", label: "Romanian", lang: "ro" },
  { code: "tr-TR", label: "Turkish", lang: "tr" },
  { code: "sr-RS", label: "Serbian", lang: "sr" },
  { code: "bg-BG", label: "Bulgarian", lang: "bg" },
  { code: "cs-CZ", label: "Czech", lang: "cs" },
  { code: "hu-HU", label: "Hungarian", lang: "hu" },
  { code: "sv-SE", label: "Swedish", lang: "sv" },
  { code: "da-DK", label: "Danish", lang: "da" },
  { code: "nb-NO", label: "Norwegian", lang: "no" },
  { code: "fi-FI", label: "Finnish", lang: "fi" },
] as const satisfies readonly { code: Both; label: string; lang: string }[];

export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number]["code"];
export const VOICE_LANGUAGE_CODES = VOICE_LANGUAGES.map((l) => l.code) as [VoiceLanguage, ...VoiceLanguage[]];

/** Voice language for a business's main language, if Twilio can do it. */
export function defaultVoiceLanguage(defaultLanguage: string): VoiceLanguage | null {
  return VOICE_LANGUAGES.find((l) => l.lang === defaultLanguage.slice(0, 2))?.code ?? null;
}

const origin = z
  .string()
  .trim()
  .transform((v) => v.replace(/\/+$/, ""))
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.origin === v && (u.protocol === "https:" || u.hostname === "localhost");
    } catch {
      return false;
    }
  }, "Use a full origin like https://www.yourhotel.com (https, no path)");

export const widgetConfigSchema = z.object({
  allowed_origins: z.array(origin).max(10, "At most 10 websites"),
  accent_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1f57d6")
    .nullable()
    .default(null),
});

const e164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/, "Use international format, e.g. +355691234567");

export const voiceConfigSchema = z.object({
  language: z.enum(VOICE_LANGUAGE_CODES),
  handoff_phone: e164.nullable().default(null),
});

export const whatsappConfigSchema = z.object({}).strict();

export type WidgetConfig = z.output<typeof widgetConfigSchema>;
export type VoiceConfig = z.output<typeof voiceConfigSchema>;

export function readVoiceConfig(value: unknown, businessLanguage: string): VoiceConfig {
  const parsed = voiceConfigSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return { language: defaultVoiceLanguage(businessLanguage) ?? "en-GB", handoff_phone: null };
}

export function readWidgetConfig(value: unknown): WidgetConfig {
  const parsed = widgetConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : { allowed_origins: [], accent_color: null };
}
