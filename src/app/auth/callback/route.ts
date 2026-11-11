import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { appUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Landing point for links in Supabase Auth emails (verification, password
 * recovery, email change). Supports both:
 *   - PKCE:       /auth/callback?code=...                 (default templates)
 *   - Token hash: /auth/callback?token_hash=...&type=...  (recommended
 *                 templates; works even if the link is opened on another device)
 * Redirect targets are restricted to same-origin paths.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  let next = safeRedirectPath(params.get("next"), "/dashboard");

  const supabase = await createClient();
  let ok = false;

  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
    if (type === "recovery") next = "/auth/reset-password";
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) {
    // Typical causes: expired link, link already used, or opened in a
    // different browser than the one that requested it (PKCE).
    return NextResponse.redirect(appUrl("/auth/login?error=link-invalid"));
  }

  return NextResponse.redirect(appUrl(next));
}
