/**
 * Operator identity for the legal pages. Set the NEXT_PUBLIC_COMPANY_* and
 * NEXT_PUBLIC_SUPPORT_EMAIL variables before launch (npm run check:env).
 * Referenced literally so Next.js can inline them.
 */
export function legalInfo() {
  return {
    company: process.env.NEXT_PUBLIC_COMPANY_NAME || "[Company name — set NEXT_PUBLIC_COMPANY_NAME]",
    address: process.env.NEXT_PUBLIC_COMPANY_ADDRESS || "[Registered address — set NEXT_PUBLIC_COMPANY_ADDRESS]",
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "[support email — set NEXT_PUBLIC_SUPPORT_EMAIL]",
    configured: Boolean(process.env.NEXT_PUBLIC_COMPANY_NAME && process.env.NEXT_PUBLIC_COMPANY_ADDRESS && process.env.NEXT_PUBLIC_SUPPORT_EMAIL),
  };
}

/** Third parties that process personal data for HotelAI (keep in sync with docs/legal/subprocessors.md). */
export const SUBPROCESSORS = [
  { name: "Supabase", purpose: "Database, authentication and file storage", data: "All account and workspace data", location: "Region chosen for the project (EU recommended)" },
  { name: "Vercel (or your chosen host)", purpose: "Application hosting", data: "Request data, logs", location: "Global edge / chosen region" },
  { name: "OpenAI", purpose: "Generating AI agent replies", data: "Conversation messages, business knowledge", location: "USA" },
  { name: "Resend", purpose: "Transactional email", data: "Email addresses, email content", location: "USA / EU" },
  { name: "Paddle", purpose: "Payments, invoicing and tax (merchant of record)", data: "Billing contact and payment details", location: "UK / EU / USA" },
  { name: "Twilio", purpose: "Phone calls and WhatsApp (only if enabled)", data: "Phone numbers, call speech transcripts, messages", location: "USA / chosen region" },
] as const;
