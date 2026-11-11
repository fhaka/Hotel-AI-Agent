/** Transactional email templates. Every interpolated value is HTML-escaped. */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type RenderedEmail = { subject: string; html: string; text: string };

function layout(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e3e8f0;border-radius:12px">
<tr><td style="padding:32px">
<p style="margin:0 0 24px;font-weight:bold;font-size:18px">Hotel<span style="color:#1f57d6">AI</span></p>
${bodyHtml}
</td></tr></table>
<p style="font-size:12px;color:#8a94a8;margin-top:16px">You received this email because of activity on HotelAI.</p>
</td></tr></table></body></html>`;
}

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", manager: "Manager", staff: "Staff" };

export function invitationEmail(input: {
  businessName: string;
  inviterName: string | null;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}): RenderedEmail {
  const role = ROLE_LABELS[input.role] ?? input.role;
  const inviter = input.inviterName?.trim() || "A team member";
  const expires = input.expiresAt.toUTCString();
  const subject = `You're invited to join ${input.businessName} on HotelAI`;
  const html = layout(`
<h1 style="font-size:20px;margin:0 0 16px">Join ${escapeHtml(input.businessName)}</h1>
<p style="line-height:1.6">${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(input.businessName)}</strong> as <strong>${escapeHtml(role)}</strong>.</p>
<p style="margin:28px 0"><a href="${escapeHtml(input.acceptUrl)}" style="background:#1f57d6;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Accept invitation</a></p>
<p style="font-size:13px;color:#55627a;line-height:1.6">Sign in or create an account with this email address to accept. The link expires on ${escapeHtml(expires)} and can be used once. If you weren't expecting this, you can ignore this email.</p>`);
  const text = `${inviter} invited you to join ${input.businessName} on HotelAI as ${role}.

Accept the invitation: ${input.acceptUrl}

Sign in or create an account with this email address to accept. The link expires on ${expires} and can be used once. If you weren't expecting this, you can ignore this email.`;
  return { subject, html, text };
}
