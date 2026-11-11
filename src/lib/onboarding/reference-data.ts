import type { Database } from "@/lib/supabase/database.types";

export type Industry = Database["public"]["Enums"]["industry"];

export const INDUSTRIES: { value: Industry; label: string; note?: string }[] = [
  { value: "hotel", label: "Hotel or guesthouse", note: "Full support: receptionist and reservation assistant" },
  { value: "restaurant", label: "Restaurant" },
  { value: "beauty_salon", label: "Beauty salon" },
  { value: "clinic", label: "Medical or dental clinic", note: "Administrative tasks only — no medical advice" },
  { value: "real_estate", label: "Real estate agency" },
  { value: "other", label: "Other service business" },
];

/** Languages offered for agents and the business profile (ISO 639-1). */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "German" },
  { code: "fr", label: "French" },
  { code: "it", label: "Italian" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "sq", label: "Albanian" },
  { code: "el", label: "Greek" },
  { code: "hr", label: "Croatian" },
  { code: "sr", label: "Serbian" },
  { code: "sl", label: "Slovenian" },
  { code: "mk", label: "Macedonian" },
  { code: "bg", label: "Bulgarian" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
  { code: "pl", label: "Polish" },
  { code: "cs", label: "Czech" },
  { code: "sk", label: "Slovak" },
  { code: "da", label: "Danish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "fi", label: "Finnish" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ar", label: "Arabic" },
  { code: "he", label: "Hebrew" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

/** ISO 3166-1 alpha-2 country codes. Names are rendered with Intl.DisplayNames. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW " +
  "BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ " +
  "FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ " +
  "IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH " +
  "MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL " +
  "PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD " +
  "TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

export function countryOptions(locale = "en"): { code: string; label: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ code, label: names.of(code) ?? code })).sort((a, b) =>
    a.label.localeCompare(b.label, locale),
  );
}

/** IANA time zones accepted by both the browser runtime and PostgreSQL. */
export function timeZoneOptions(): string[] {
  return ["UTC", ...Intl.supportedValuesOf("timeZone")];
}

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "ALL", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY"];

export const WEEKDAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

export type WeekdayKey = (typeof WEEKDAYS)[number]["key"];
