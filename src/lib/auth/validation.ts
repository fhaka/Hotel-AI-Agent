import { z } from "zod";

/** Shared, server-enforced validation for authentication forms. */

export const PASSWORD_MIN = 10;
// bcrypt (used by Supabase Auth) only considers the first 72 bytes.
export const PASSWORD_MAX = 72;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address")
  .max(320, "Email address is too long")
  .pipe(z.email("Enter a valid email address"));

const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .refine((v) => new TextEncoder().encode(v).length <= PASSWORD_MAX, `Use at most ${PASSWORD_MAX} bytes`)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), "Include at least one letter and one number");

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(200, "Name is too long"),
  email,
  password: newPassword,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(1024),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type FieldErrors = Partial<Record<string, string>>;

/** Flattens Zod issues into one message per field for form display. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export function formDataToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}
