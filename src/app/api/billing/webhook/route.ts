import type { NextRequest } from "next/server";
import { handleBillingWebhook } from "@/lib/billing/webhook-handler";

/** Signed Paddle webhooks. See src/lib/billing/webhook-handler.ts. */
export async function POST(request: NextRequest) {
  return handleBillingWebhook(request);
}
