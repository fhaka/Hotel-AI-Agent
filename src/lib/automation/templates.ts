import { escapeHtml, type RenderedEmail } from "@/lib/email/templates";

/** Email templates for automated notifications. All values are escaped. */

function layout(title: string, bodyHtml: string, brand = "HotelAI"): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e8f0;border-radius:12px">
<tr><td style="padding:32px"><p style="margin:0 0 24px;font-weight:bold;font-size:18px">${escapeHtml(brand)}</p>
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr></table>
</td></tr></table></body></html>`;
}

function button(label: string, url: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="background:#1f57d6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapeHtml(label)}</a></p>`;
}

function rows(items: [string, string][]): string {
  return `<table role="presentation" cellpadding="6" cellspacing="0" style="font-size:14px;margin:12px 0">${items
    .map(([k, v]) => `<tr><td style="color:#55627a">${escapeHtml(k)}</td><td style="font-weight:bold">${escapeHtml(v)}</td></tr>`)
    .join("")}</table>`;
}

export function preArrivalEmail(d: {
  businessName: string;
  guestName: string;
  reference: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  checkInTime: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}): RenderedEmail {
  const items: [string, string][] = [
    ["Confirmation number", d.reference],
    ["Room", d.roomType],
    ["Check-in", `${d.checkIn}${d.checkInTime ? ` from ${d.checkInTime}` : ""}`],
    ["Check-out", d.checkOut],
  ];
  if (d.address) items.push(["Address", d.address]);
  const contact = [d.phone, d.email].filter(Boolean).join(" · ");
  return {
    subject: `See you soon at ${d.businessName}`,
    html: layout(
      "Your stay is coming up",
      `<p style="line-height:1.6">Dear ${escapeHtml(d.guestName)}, we look forward to welcoming you.</p>${rows(items)}${contact ? `<p style="font-size:13px;color:#55627a">Questions? ${escapeHtml(contact)}</p>` : ""}`,
      d.businessName,
    ),
    text: [`Dear ${d.guestName}, we look forward to welcoming you at ${d.businessName}.`, "", ...items.map(([k, v]) => `${k}: ${v}`), contact ? `\nQuestions? ${contact}` : ""].join("\n"),
  };
}

export function trialEndingEmail(d: { businessName: string; endsAt: string; billingUrl: string }): RenderedEmail {
  return {
    subject: `Your HotelAI trial for ${d.businessName} ends soon`,
    html: layout(
      "Your free trial ends soon",
      `<p style="line-height:1.6">The free trial for <strong>${escapeHtml(d.businessName)}</strong> ends on ${escapeHtml(d.endsAt)}. Choose a plan to keep your AI agents answering guests. Your data stays safe either way.</p>${button("Choose a plan", d.billingUrl)}`,
    ),
    text: `The free trial for ${d.businessName} ends on ${d.endsAt}. Choose a plan to keep your AI agents running: ${d.billingUrl}\nYour data stays safe either way.`,
  };
}

export function trialEndedEmail(d: { businessName: string; billingUrl: string }): RenderedEmail {
  return {
    subject: `Your HotelAI trial for ${d.businessName} has ended`,
    html: layout(
      "Your free trial has ended",
      `<p style="line-height:1.6">Your AI agents for <strong>${escapeHtml(d.businessName)}</strong> are paused. You can still sign in and see all your data, and pick up where you left off by choosing a plan.</p>${button("Choose a plan", d.billingUrl)}`,
    ),
    text: `Your AI agents for ${d.businessName} are paused because the free trial ended. Your data is kept. Choose a plan: ${d.billingUrl}`,
  };
}

export function paymentFailedEmail(d: { businessName: string; billingUrl: string }): RenderedEmail {
  return {
    subject: `Payment problem for ${d.businessName}`,
    html: layout(
      "We couldn't process your payment",
      `<p style="line-height:1.6">The latest payment for <strong>${escapeHtml(d.businessName)}</strong> failed. Our payment provider will retry automatically. Please update your payment details to avoid an interruption.</p>${button("Update payment details", d.billingUrl)}`,
    ),
    text: `The latest payment for ${d.businessName} failed and will be retried. Please update your payment details: ${d.billingUrl}`,
  };
}

export function escalationEmail(d: {
  businessName: string;
  unanswered: boolean;
  hoursOpen: number;
  reason: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  conversationUrl: string;
}): RenderedEmail {
  const items: [string, string][] = [["Request", d.reason]];
  if (d.customerName) items.push(["Name", d.customerName]);
  if (d.customerEmail) items.push(["Email", d.customerEmail]);
  if (d.customerPhone) items.push(["Phone", d.customerPhone]);
  const title = d.unanswered ? `Still waiting for a reply (${d.hoursOpen} h)` : "A guest needs a person";
  return {
    subject: `${d.unanswered ? "Reminder: " : ""}Guest request needs attention — ${d.businessName}`,
    html: layout(
      title,
      `<p style="line-height:1.6">Your AI assistant handed a conversation over to your team.</p>${rows(items)}${button("Open conversation", d.conversationUrl)}<p style="font-size:13px;color:#55627a">Mark it as handled when done to stop reminders.</p>`,
      d.businessName,
    ),
    text: [`${title} — ${d.businessName}`, "", ...items.map(([k, v]) => `${k}: ${v}`), "", `Open: ${d.conversationUrl}`, "Mark it as handled when done to stop reminders."].join("\n"),
  };
}

export type DailyReport = {
  date: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  newBookings24h: number;
  aiBookings24h: number;
  conversations24h: number;
  openEscalations: number;
  aiMessagesUsed: number;
  aiMessagesLimit: number | null;
};

export function dailyReportEmail(d: { businessName: string; dashboardUrl: string; isHotel: boolean; report: DailyReport }): RenderedEmail {
  const r = d.report;
  const items: [string, string][] = [
    ...(d.isHotel
      ? ([
          ["Arrivals today", String(r.arrivals)],
          ["Departures today", String(r.departures)],
          ["Guests in house", String(r.inHouse)],
          ["New bookings (24 h)", `${r.newBookings24h} (${r.aiBookings24h} by AI)`],
        ] as [string, string][])
      : []),
    ["AI conversations (24 h)", String(r.conversations24h)],
    ["Open hand-overs", String(r.openEscalations)],
    ["AI messages this period", r.aiMessagesLimit === null ? String(r.aiMessagesUsed) : `${r.aiMessagesUsed} / ${r.aiMessagesLimit}`],
  ];
  return {
    subject: `Daily summary for ${d.businessName} — ${r.date}`,
    html: layout(`Your day at ${d.businessName}`, `${rows(items)}${button("Open dashboard", d.dashboardUrl)}`),
    text: [`Daily summary for ${d.businessName} — ${r.date}`, "", ...items.map(([k, v]) => `${k}: ${v}`), "", d.dashboardUrl].join("\n"),
  };
}

export function welcomeEmail(d: { businessName: string; dashboardUrl: string }): RenderedEmail {
  const steps = ["Add your FAQs and services to the knowledge base", "Test your agents in the playground", "Invite your team"];
  return {
    subject: `Welcome to HotelAI, ${d.businessName}`,
    html: layout(
      "Your workspace is ready",
      `<p style="line-height:1.6">Your 7-day free trial has started. Next steps:</p><ol style="line-height:1.8">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>${button("Open your dashboard", d.dashboardUrl)}`,
    ),
    text: [`Welcome to HotelAI, ${d.businessName}. Your 7-day free trial has started.`, "", ...steps.map((s, i) => `${i + 1}. ${s}`), "", d.dashboardUrl].join("\n"),
  };
}

export function callSummaryEmail(d: {
  businessName: string;
  startedAt: string;
  turns: { who: "Caller" | "Assistant"; text: string }[];
  escalationReason: string | null;
  bookingNote: string | null;
  conversationUrl: string;
}): RenderedEmail {
  const lines = d.turns.slice(0, 30);
  const html = layout(
    "Phone call summary",
    `<p style="line-height:1.6">Call answered by your AI phone assistant on ${escapeHtml(d.startedAt)}.</p>
${d.escalationReason ? `<p style="background:#fffaeb;padding:10px;border-radius:8px"><strong>Needs follow-up:</strong> ${escapeHtml(d.escalationReason)}</p>` : ""}
${d.bookingNote ? `<p><strong>${escapeHtml(d.bookingNote)}</strong></p>` : ""}
<table role="presentation" cellpadding="4" cellspacing="0" style="font-size:13px">${lines
      .map((t) => `<tr><td style="color:#55627a;vertical-align:top;white-space:nowrap">${t.who}</td><td>${escapeHtml(t.text)}</td></tr>`)
      .join("")}</table>
${button("Open transcript", d.conversationUrl)}`,
    d.businessName,
  );
  const text = [
    `Phone call summary — ${d.businessName} (${d.startedAt})`,
    d.escalationReason ? `Needs follow-up: ${d.escalationReason}` : "",
    d.bookingNote ?? "",
    "",
    ...lines.map((t) => `${t.who}: ${t.text}`),
    "",
    d.conversationUrl,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
  return { subject: `${d.escalationReason ? "Follow-up needed: " : ""}Phone call summary — ${d.businessName}`, html, text };
}
