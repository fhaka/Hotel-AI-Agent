import { z } from "zod";

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter an email address")
    .max(320)
    .pipe(z.email("Enter a valid email address")),
  role: z.enum(["admin", "manager", "staff"], { error: "Choose a role" }),
});

export const roleChangeSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["owner", "admin", "manager", "staff"]),
});
