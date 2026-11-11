import { describe, expect, it } from "vitest";
import { isGuestOnlyPath, isProtectedPath, safeRedirectPath } from "@/lib/auth/redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/dashboard/agents?tab=1#x", "/dashboard/agents?tab=1#x"],
    ["/onboarding", "/onboarding"],
  ])("allows same-origin path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "dashboard",
    "",
    undefined,
    null,
    42,
    "/" + "a".repeat(600),
  ])("rejects unsafe target %j", (input) => {
    expect(safeRedirectPath(input)).toBe("/dashboard");
  });

  it("uses the provided fallback", () => {
    expect(safeRedirectPath("//evil", "/auth/login")).toBe("/auth/login");
  });
});

describe("route classification", () => {
  it.each(["/dashboard", "/dashboard/billing", "/onboarding", "/admin", "/admin/plans"])(
    "%s is protected",
    (path) => expect(isProtectedPath(path)).toBe(true),
  );

  it.each(["/", "/pricing", "/auth/login", "/dashboards", "/administrator"])("%s is public", (path) =>
    expect(isProtectedPath(path)).toBe(false),
  );

  it("treats login/sign-up as guest-only but not reset-password", () => {
    expect(isGuestOnlyPath("/auth/login")).toBe(true);
    expect(isGuestOnlyPath("/auth/sign-up")).toBe(true);
    expect(isGuestOnlyPath("/auth/reset-password")).toBe(false);
    expect(isGuestOnlyPath("/auth/callback")).toBe(false);
  });
});
