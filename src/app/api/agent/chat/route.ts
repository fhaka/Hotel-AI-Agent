import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { AgentError } from "@/lib/agents/runtime/errors";
import { MAX_MESSAGE_CHARS, runPlaygroundTurn } from "@/lib/agents/runtime/service";
import { getCurrentUser } from "@/lib/auth/session";
import { getPublicEnv } from "@/lib/env";
import { isSameOriginRequest } from "@/lib/security/origin";

export const maxDuration = 120;

const bodySchema = z.strictObject({
  agentId: z.uuid(),
  conversationId: z.uuid().nullable(),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

const MAX_BODY_BYTES = 16_000;

function error(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/agent/chat — playground chat for signed-in staff.
 * Cookie-authenticated, so it requires same-origin + JSON (CSRF defence).
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers, getPublicEnv().NEXT_PUBLIC_APP_URL)) {
    return error("forbidden_origin", "Cross-origin requests are not allowed.", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return error("invalid_request", "Content-Type must be application/json.", 415);
  }
  const user = await getCurrentUser();
  if (!user) return error("unauthenticated", "Please sign in again.", 401);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return error("invalid_request", "Request is too large.", 413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return error("invalid_request", "Request body must be valid JSON.", 400);
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return error("invalid_request", `Messages must be between 1 and ${MAX_MESSAGE_CHARS} characters.`, 400);
  }

  try {
    const result = await runPlaygroundTurn({ user, ...parsed.data });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof AgentError) return error(err.code, err.message, err.status);
    console.error("[api/agent/chat] unexpected error", { name: err instanceof Error ? err.name : "unknown" });
    return error("internal_error", "Something went wrong. Please try again.", 500);
  }
}
