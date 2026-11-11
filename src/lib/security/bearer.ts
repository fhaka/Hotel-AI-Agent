import { timingSafeEqual } from "node:crypto";

/** Constant-time check of an `Authorization: Bearer <secret>` header. */
export function hasValidBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
