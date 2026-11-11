"use server";

import { redirect } from "next/navigation";
import { appUrl } from "@/lib/env";
import { safeRedirectPath } from "@/lib/auth/redirect";
import {
  type FieldErrors,
  forgotPasswordSchema,
  formDataToObject,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
  toFieldErrors,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

export type AuthFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: FieldErrors;
  /** Echo of non-secret input so the form can be re-filled after an error. */
  values?: Record<string, string>;
};

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

/**
 * Registration. Supabase sends a verification email; the account cannot sign
 * in until the address is confirmed (enable "Confirm email" in Supabase Auth).
 */
export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = formDataToObject(formData);
  const parsed = signUpSchema.safeParse(raw);
  const values = { fullName: raw.fullName ?? "", email: raw.email ?? "" };
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  }

  // Where to land after verifying (e.g. an invitation link); same-origin paths only.
  const next = safeRedirectPath(raw.next, "/onboarding");
  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: appUrl(`/auth/callback?next=${encodeURIComponent(next)}`),
    },
  });

  if (error) {
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: error.message }, values };
    }
    if (error.code === "over_email_send_rate_limit" || error.status === 429) {
      return { status: "error", message: "Too many attempts. Please wait a few minutes and try again.", values };
    }
    console.error("[auth] sign-up failed", { code: error.code, status: error.status });
    return { status: "error", message: GENERIC_ERROR, values };
  }

  // Deliberately identical response whether or not the email already exists,
  // so the form cannot be used to discover registered addresses.
  return {
    status: "success",
    message: `If ${parsed.data.email} can be registered, we've sent a verification link to it. Open the link to activate your account.`,
    values: { email: parsed.data.email },
  };
}

export async function signIn(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = formDataToObject(formData);
  const parsed = loginSchema.safeParse(raw);
  const values = { email: raw.email ?? "" };
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        status: "error",
        message: "Please verify your email address first. We can send you a new verification link.",
        values: { ...values, unconfirmed: "1" },
      };
    }
    if (error.status === 429) {
      return { status: "error", message: "Too many sign-in attempts. Please wait a few minutes.", values };
    }
    if (error.code !== "invalid_credentials") {
      console.error("[auth] sign-in failed", { code: error.code, status: error.status });
    }
    return { status: "error", message: "Incorrect email or password.", values };
  }

  redirect(safeRedirectPath(raw.next));
}

export async function resendVerification(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = forgotPasswordSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: appUrl("/auth/callback?next=/onboarding") },
  });
  if (error && error.status === 429) {
    return { status: "error", message: "Please wait a minute before requesting another email." };
  }
  if (error) console.error("[auth] resend failed", { code: error.code, status: error.status });
  return { status: "success", message: "If that account is awaiting verification, a new link is on its way." };
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const raw = formDataToObject(formData);
  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error), values: { email: raw.email ?? "" } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: appUrl("/auth/callback?next=/auth/reset-password"),
  });
  if (error && error.status === 429) {
    return { status: "error", message: "Too many requests. Please wait a few minutes and try again." };
  }
  if (error) console.error("[auth] reset request failed", { code: error.code, status: error.status });

  // Same response whether or not the account exists.
  return {
    status: "success",
    message: "If an account exists for that email, you'll receive a password reset link shortly.",
  };
}

/** Sets a new password. Requires the short-lived session created by the recovery link. */
export async function updatePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = resetPasswordSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: toFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return {
      status: "error",
      message: "Your reset link has expired or was already used. Please request a new one.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { status: "error", fieldErrors: { password: "Choose a password you haven't used before." } };
    }
    if (error.code === "weak_password") {
      return { status: "error", fieldErrors: { password: error.message } };
    }
    console.error("[auth] password update failed", { code: error.code, status: error.status });
    return { status: "error", message: GENERIC_ERROR };
  }

  redirect("/dashboard?notice=password-updated");
}

/**
 * Sign out. Invoked only via POST form submission; Next.js Server Actions
 * reject cross-origin requests, so this is not triggerable via CSRF.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/auth/login?notice=signed-out");
}
