import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, invitationEmail } from "@/lib/email/templates";

vi.mock("server-only", () => ({}));

const sendMock = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

describe("templates", () => {
  it("escapes HTML in every interpolated value", () => {
    const email = invitationEmail({
      businessName: `<script>alert("x")</script> & Co`,
      inviterName: `Eve <img src=x onerror=alert(1)>`,
      role: "staff",
      acceptUrl: `https://app.example/invite/abc"><script>`,
      expiresAt: new Date("2026-11-18T12:00:00Z"),
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp; Co");
    expect(email.text).toContain("as Staff");
    expect(email.subject).toContain("& Co");
  });

  it("escapeHtml handles quotes", () => {
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});

describe("sendEmail", () => {
  const env = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const input = { to: "a@example.test", subject: "s", html: "<p>h</p>", text: "t", idempotencyKey: "invite-1" };

  it("reports not_configured instead of pretending to send", async () => {
    delete process.env.RESEND_API_KEY;
    const { sendEmail } = await import("@/lib/email/send");
    expect(await sendEmail(input)).toEqual({ status: "not_configured" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends with the idempotency key and returns the id", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "HotelAI <no-reply@example.test>";
    sendMock.mockResolvedValue({ data: { id: "email_1" }, error: null, headers: null });
    const { sendEmail } = await import("@/lib/email/send");
    expect(await sendEmail(input)).toEqual({ status: "sent", id: "email_1" });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: "HotelAI <no-reply@example.test>", to: "a@example.test" }),
      { idempotencyKey: "invite-1" },
    );
  });

  it("retries once on retryable errors (same idempotency key) but not on validation errors", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "x@example.test";
    sendMock
      .mockResolvedValueOnce({ data: null, error: { name: "rate_limit_exceeded", statusCode: 429, message: "" }, headers: null })
      .mockResolvedValueOnce({ data: { id: "email_2" }, error: null, headers: null });
    const { sendEmail } = await import("@/lib/email/send");
    expect(await sendEmail(input)).toEqual({ status: "sent", id: "email_2" });
    expect(sendMock.mock.calls.map((c) => c[1].idempotencyKey)).toEqual(["invite-1", "invite-1"]);

    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: null, error: { name: "validation_error", statusCode: 422, message: "" }, headers: null });
    expect(await sendEmail(input)).toEqual({ status: "failed", retryable: false, code: "validation_error" });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("treats thrown network errors as retryable failures and never throws", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "x@example.test";
    sendMock.mockRejectedValue(new Error("ECONNRESET"));
    const { sendEmail } = await import("@/lib/email/send");
    expect(await sendEmail(input)).toEqual({ status: "failed", retryable: true, code: "network_error" });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
