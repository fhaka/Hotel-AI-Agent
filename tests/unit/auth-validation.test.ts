import { describe, expect, it } from "vitest";
import {
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
  toFieldErrors,
} from "@/lib/auth/validation";

describe("signUpSchema", () => {
  const valid = { fullName: "Ada Lovelace", email: "  Ada@Example.COM ", password: "correcthorse9" };

  it("accepts valid input and normalises the email", () => {
    const parsed = signUpSchema.parse(valid);
    expect(parsed.email).toBe("ada@example.com");
    expect(parsed.fullName).toBe("Ada Lovelace");
  });

  it("rejects short passwords", () => {
    const r = signUpSchema.safeParse({ ...valid, password: "abc123" });
    expect(r.success).toBe(false);
    if (!r.success) expect(toFieldErrors(r.error).password).toMatch(/at least 10/);
  });

  it("requires a letter and a number", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "onlyletterslong" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...valid, password: "1234567890123" }).success).toBe(false);
  });

  it("rejects passwords longer than 72 bytes (bcrypt limit)", () => {
    expect(signUpSchema.safeParse({ ...valid, password: "a1" + "é".repeat(40) }).success).toBe(false);
  });

  it("rejects invalid emails", () => {
    const r = signUpSchema.safeParse({ ...valid, email: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) expect(toFieldErrors(r.error).email).toBeDefined();
  });
});

describe("loginSchema", () => {
  it("requires both fields", () => {
    const r = loginSchema.safeParse({ email: "", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const errors = toFieldErrors(r.error);
      expect(errors.email).toBeDefined();
      expect(errors.password).toBeDefined();
    }
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    const r = resetPasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "newpassword2" });
    expect(r.success).toBe(false);
    if (!r.success) expect(toFieldErrors(r.error).confirmPassword).toBe("Passwords do not match");
  });

  it("accepts matching strong passwords", () => {
    expect(resetPasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "newpassword1" }).success).toBe(
      true,
    );
  });
});
