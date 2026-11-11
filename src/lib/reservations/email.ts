import { escapeHtml, type RenderedEmail } from "@/lib/email/templates";
import { formatCurrency } from "@/lib/knowledge/context";
import { formatStayDate } from "./dates";

export type ReservationEmailData = {
  businessName: string;
  businessEmail: string | null;
  businessPhone: string | null;
  businessAddress: string | null;
  guestName: string;
  reference: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  totalCents: number;
  currency: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  cancellationPolicy: string | null;
};

function wrap(body: string, businessName: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e8f0;border-radius:12px">
<tr><td style="padding:32px"><p style="margin:0 0 24px;font-weight:bold;font-size:18px">${escapeHtml(businessName)}</p>${body}</td></tr></table>
</td></tr></table></body></html>`;
}

function contactLine(d: ReservationEmailData): string {
  return [d.businessPhone, d.businessEmail, d.businessAddress].filter(Boolean).join(" · ");
}

export function reservationConfirmationEmail(d: ReservationEmailData): RenderedEmail {
  const total = formatCurrency(d.totalCents, d.currency);
  const rows: [string, string][] = [
    ["Confirmation number", d.reference],
    ["Room", d.roomType],
    ["Check-in", `${formatStayDate(d.checkIn)}${d.checkInTime ? ` from ${d.checkInTime}` : ""}`],
    ["Check-out", `${formatStayDate(d.checkOut)}${d.checkOutTime ? ` by ${d.checkOutTime}` : ""}`],
    ["Nights", String(d.nights)],
    ["Guests", String(d.guests)],
    ["Total", total],
  ];
  const html = wrap(
    `<h1 style="font-size:20px;margin:0 0 16px">Your reservation is confirmed</h1>
<p style="line-height:1.6">Dear ${escapeHtml(d.guestName)}, thank you for booking with ${escapeHtml(d.businessName)}.</p>
<table role="presentation" cellpadding="6" cellspacing="0" style="margin:16px 0;font-size:14px">
${rows.map(([k, v]) => `<tr><td style="color:#55627a">${escapeHtml(k)}</td><td style="font-weight:bold">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
${d.cancellationPolicy ? `<p style="font-size:13px;color:#55627a;line-height:1.6"><strong>Cancellation policy:</strong> ${escapeHtml(d.cancellationPolicy)}</p>` : ""}
<p style="font-size:13px;color:#55627a">${escapeHtml(contactLine(d))}</p>`,
    d.businessName,
  );
  const text = [
    `Your reservation at ${d.businessName} is confirmed.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    d.cancellationPolicy ? `\nCancellation policy: ${d.cancellationPolicy}` : "",
    "",
    contactLine(d),
  ].join("\n");
  return { subject: `Reservation confirmed — ${d.businessName} (${d.reference})`, html, text };
}

export function reservationCancellationEmail(d: ReservationEmailData): RenderedEmail {
  const html = wrap(
    `<h1 style="font-size:20px;margin:0 0 16px">Your reservation has been canceled</h1>
<p style="line-height:1.6">Dear ${escapeHtml(d.guestName)}, your reservation <strong>${escapeHtml(d.reference)}</strong> (${escapeHtml(formatStayDate(d.checkIn))} – ${escapeHtml(formatStayDate(d.checkOut))}) at ${escapeHtml(d.businessName)} has been canceled.</p>
<p style="font-size:13px;color:#55627a">Questions? ${escapeHtml(contactLine(d))}</p>`,
    d.businessName,
  );
  const text = `Your reservation ${d.reference} (${formatStayDate(d.checkIn)} – ${formatStayDate(d.checkOut)}) at ${d.businessName} has been canceled.\n\nQuestions? ${contactLine(d)}`;
  return { subject: `Reservation canceled — ${d.businessName} (${d.reference})`, html, text };
}
