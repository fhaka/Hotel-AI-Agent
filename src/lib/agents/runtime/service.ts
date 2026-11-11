import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAgentConfig } from "@/lib/agents/config";
import type { CurrentUser } from "@/lib/auth/session";
import { formatInZone } from "@/lib/billing/trial";
import { checkAgentExecution } from "@/lib/entitlements/evaluate";
import { EntitlementError, getBusinessEntitlements } from "@/lib/entitlements/service";
import { entitlementSnapshotSchema } from "@/lib/entitlements/snapshot";
import { formatCurrency, formatKnowledgeContext, sanitizeKnowledgeText, type KnowledgeSources } from "@/lib/knowledge/context";
import { loadKnowledgeSources } from "@/lib/knowledge/load";
import { sendReservationEmail } from "@/lib/reservations/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { AgentError, fromTurnReason } from "./errors";
import { runToolLoop, type TurnResult } from "./loop";
import { createOpenAIModel } from "./openai-model";
import { buildInstructions } from "./prompt";
import type { ReservationServices } from "./reservation-tools";
import { toolsFor, type ToolContext } from "./tools";
import type { ChatMessage, ModelClient } from "./types";

type Admin = SupabaseClient<Database>;
type AgentRow = Pick<Database["public"]["Tables"]["agents"]["Row"], "id" | "business_id" | "agent_type" | "name" | "system_configuration">;
export type ChannelName = "playground" | "website" | "voice" | "whatsapp";

export const MAX_MESSAGE_CHARS = 2000;
const HISTORY_MESSAGES = 20;
const PLAYGROUND_TIMEOUT_MS = 90_000;

const SOURCE_FOR_CHANNEL: Record<ChannelName, "ai_website" | "ai_voice" | "ai_whatsapp"> = {
  playground: "ai_website",
  website: "ai_website",
  voice: "ai_voice",
  whatsapp: "ai_whatsapp",
};

export type TurnOutput = {
  conversationId: string;
  reply: string;
  escalated: boolean;
  toolEvents: TurnResult["toolEvents"];
  usage: { messagesUsed: number | null; messagesLimit: number | null };
};
export type PlaygroundTurnResult = TurnOutput;

async function consumeRateLimits(admin: Admin, limits: { key: string; limit: number; windowSeconds: number }[]) {
  for (const rl of limits) {
    const { data: ok, error } = await admin.rpc("consume_rate_limit", { p_key: rl.key, p_limit: rl.limit, p_window_seconds: rl.windowSeconds });
    if (error) throw new AgentError("internal_error");
    if (!ok) throw new AgentError("rate_limited");
  }
}

function validMessage(raw: string): string {
  const message = raw.trim();
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    throw new AgentError("invalid_request", `Messages must be between 1 and ${MAX_MESSAGE_CHARS} characters.`);
  }
  return message;
}

/**
 * One playground turn for a signed-in staff member.
 *   1. identity from the verified session (CurrentUser from the DAL)
 *   2. agent looked up with the USER's client (RLS proves membership); the
 *      business id comes from that row, never from the request
 *   3. entitlements incl. role -> 4. rate limits -> 5. executeTurn()
 * Bookings in the playground are always dry runs.
 */
export async function runPlaygroundTurn(
  input: { user: CurrentUser; agentId: string; conversationId: string | null; message: string },
  deps: { model?: ModelClient } = {},
): Promise<PlaygroundTurnResult> {
  const message = validMessage(input.message);
  if (!process.env.SUPABASE_SECRET_KEY) throw new AgentError("not_configured");
  const model = deps.model ?? createOpenAIModel();

  const userClient = await createClient();
  const { data: agent } = await userClient
    .from("agents")
    .select("id, business_id, agent_type, name, system_configuration")
    .eq("id", input.agentId)
    .maybeSingle();
  if (!agent) throw new AgentError("not_found");

  let decision;
  try {
    const ent = await getBusinessEntitlements(agent.business_id, input.user);
    decision = checkAgentExecution(ent.snapshot, agent.agent_type);
  } catch (err) {
    if (err instanceof EntitlementError && err.code === "not_member") throw new AgentError("not_member");
    throw new AgentError("internal_error");
  }
  if (!decision.allowed) throw new AgentError(decision.code, decision.message);

  const admin = createAdminClient();
  await consumeRateLimits(admin, [
    { key: `agent:user:${input.user.id}`, limit: 20, windowSeconds: 60 },
    { key: `agent:business:${agent.business_id}`, limit: 120, windowSeconds: 60 },
  ]);
  return executeTurn({
    admin,
    model,
    agent,
    channel: "playground",
    conversationId: input.conversationId,
    externalRef: null,
    startedBy: input.user.id,
    message,
    safetySubject: `user:${input.user.id}`,
    timeoutMs: PLAYGROUND_TIMEOUT_MS,
  });
}

/**
 * One turn on a public channel (website widget, phone, WhatsApp). The caller
 * has already resolved the business from a TRUSTED source (widget key lookup,
 * verified Twilio signature + assigned number). No user session exists, so
 * the role check is skipped; everything else (plan, trial, usage, agent
 * enabled, rate limits, conversation ownership via externalRef) applies.
 * Bookings here are real.
 */
export async function runChannelTurn(
  input: {
    businessId: string;
    agentType: "website_receptionist" | "reservation_assistant" | "voice_receptionist";
    channel: Exclude<ChannelName, "playground">;
    conversationId: string | null;
    externalRef: string;
    message: string;
    rateLimits: { key: string; limit: number; windowSeconds: number }[];
    timeoutMs: number;
  },
  deps: { model?: ModelClient; admin?: Admin } = {},
): Promise<TurnOutput> {
  const message = validMessage(input.message);
  if (!process.env.SUPABASE_SECRET_KEY) throw new AgentError("not_configured");
  const model = deps.model ?? createOpenAIModel();
  const admin = deps.admin ?? createAdminClient();

  const { data: agent } = await admin
    .from("agents")
    .select("id, business_id, agent_type, name, system_configuration")
    .eq("business_id", input.businessId)
    .eq("agent_type", input.agentType)
    .maybeSingle();
  if (!agent) throw new AgentError("not_found");

  const { data: snapshot, error } = await admin.rpc("get_business_entitlements_service", { p_business_id: input.businessId });
  const parsed = entitlementSnapshotSchema.safeParse(snapshot);
  if (error || !parsed.success) throw new AgentError("internal_error");
  const decision = checkAgentExecution(parsed.data, agent.agent_type, { requireRole: false });
  if (!decision.allowed) throw new AgentError(decision.code, decision.message);

  await consumeRateLimits(admin, [...input.rateLimits, { key: `agent:business:${input.businessId}`, limit: 300, windowSeconds: 60 }]);
  return executeTurn({
    admin,
    model,
    agent,
    channel: input.channel,
    conversationId: input.conversationId,
    externalRef: input.externalRef,
    startedBy: null,
    message,
    safetySubject: `${input.channel}:${input.externalRef}`,
    timeoutMs: input.timeoutMs,
  });
}

/**
 * The shared core: atomic begin (DB re-checks entitlements and limits, binds
 * the conversation), knowledge + instructions, tool loop, completion or
 * refund. Identical for every channel.
 */
async function executeTurn(t: {
  admin: Admin;
  model: ModelClient;
  agent: AgentRow;
  channel: ChannelName;
  conversationId: string | null;
  externalRef: string | null;
  startedBy: string | null;
  message: string;
  safetySubject: string;
  timeoutMs: number;
}): Promise<TurnOutput> {
  const { admin, agent } = t;
  const businessId = agent.business_id;
  const { data: begun, error: beginError } = await admin.rpc("begin_agent_turn", {
    p_business_id: businessId,
    p_agent_id: agent.id,
    p_channel: t.channel,
    // null = new conversation (generated types don't model nullable SQL params)
    p_conversation_id: t.conversationId as string,
    p_started_by: t.startedBy as string,
    p_customer_message: t.message,
    p_external_ref: t.externalRef ?? undefined,
  });
  if (beginError) {
    console.error("[agent] begin_agent_turn failed", { code: beginError.code });
    throw new AgentError("internal_error");
  }
  const turn = begun as {
    allowed: boolean;
    reason?: string;
    conversation_id: string;
    customer_message_id: number;
    usage_event_id: number;
    messages_used?: number;
    messages_limit?: number | null;
  };
  if (!turn.allowed) throw fromTurnReason(turn.reason);

  try {
    const sources = await loadKnowledgeSources(admin, businessId);
    if (!sources) throw new AgentError("not_found");
    const knowledge = formatKnowledgeContext(sources);
    const config = readAgentConfig(agent.system_configuration);
    const canary = `HAI-${randomBytes(6).toString("hex")}`;

    const { data: past } = await admin
      .from("agent_messages")
      .select("id, sender_type, content")
      .eq("business_id", businessId)
      .eq("conversation_id", turn.conversation_id)
      .in("sender_type", ["customer", "agent"])
      .lt("id", turn.customer_message_id)
      .order("id", { ascending: false })
      .limit(HISTORY_MESSAGES);
    const messages: ChatMessage[] = [
      ...(past ?? []).reverse().map((m): ChatMessage => ({ role: m.sender_type === "agent" ? "assistant" : "user", content: m.content })),
      { role: "user", content: t.message },
    ];

    const ctx: ToolContext = {
      businessId,
      conversationId: turn.conversation_id,
      agentId: agent.id,
      escalationMessage: config.escalation_message || null,
      services: {
        async searchKnowledge(query) {
          const { data, error } = await admin.rpc("search_agent_knowledge", { p_business_id: businessId, p_query: query, p_limit: 5, p_offset: 0 });
          if (error) throw new Error("search_failed");
          return (data ?? []).map((r) => ({
            title: sanitizeKnowledgeText(r.title),
            content: sanitizeKnowledgeText(r.content).slice(0, 1500),
            category: r.category,
          }));
        },
        async escalate(details) {
          const { data, error } = await admin.rpc("escalate_conversation", {
            p_business_id: businessId,
            p_conversation_id: turn.conversation_id,
            p_details: details as never,
          });
          if (error) throw new Error("escalation_failed");
          return Boolean(data);
        },
        reservations:
          agent.agent_type === "reservation_assistant" || agent.agent_type === "voice_receptionist"
            ? await reservationServices(admin, {
                businessId,
                conversationId: turn.conversation_id,
                customerMessageId: turn.customer_message_id,
                sources,
                dryRun: t.channel === "playground", // test bookings are never saved
                source: SOURCE_FOR_CHANNEL[t.channel],
              })
            : undefined,
      },
    };

    const result = await runToolLoop({
      priorText: [...(past ?? []).map((m) => m.content), knowledge.text],
      model: t.model,
      instructions: buildInstructions({
        agentType: agent.agent_type,
        agentName: agent.name,
        businessName: sources.business.name,
        industry: sources.business.industry,
        languages: sources.business.supported_languages,
        defaultLanguage: sources.business.default_language,
        config,
        knowledgeBlock: knowledge.text,
        channel: t.channel,
        localTime: formatInZone(new Date(), sources.business.timezone),
        timezone: sources.business.timezone,
        canary,
      }),
      messages,
      tools: toolsFor(agent.agent_type),
      ctx,
      canary,
      safetyIdentifier: createHash("sha256").update(`hotelai:${t.safetySubject}`).digest("hex").slice(0, 32),
      signal: AbortSignal.timeout(t.timeoutMs),
    });

    const { error: completeError } = await admin.rpc("complete_agent_turn", {
      p_business_id: businessId,
      p_conversation_id: turn.conversation_id,
      p_agent_id: agent.id,
      p_reply: result.reply,
      p_tool_events: result.toolEvents,
      p_input_tokens: result.usage.inputTokens,
      p_output_tokens: result.usage.outputTokens,
      p_model: result.model,
    });
    if (completeError) {
      console.error("[agent] complete_agent_turn failed", { code: completeError.code });
      throw new AgentError("internal_error");
    }
    return {
      conversationId: turn.conversation_id,
      reply: result.reply,
      escalated: result.escalated,
      toolEvents: result.toolEvents,
      usage: { messagesUsed: turn.messages_used ?? null, messagesLimit: turn.messages_limit ?? null },
    };
  } catch (err) {
    const agentError = err instanceof AgentError ? err : new AgentError("internal_error");
    if (!(err instanceof AgentError)) console.error("[agent] turn failed", { name: err instanceof Error ? err.name : "unknown" });
    await admin
      .rpc("fail_agent_turn", {
        p_business_id: businessId,
        p_conversation_id: turn.conversation_id,
        p_usage_event_id: turn.usage_event_id,
        p_error_code: agentError.code,
      })
      .then(({ error }) => error && console.error("[agent] fail_agent_turn failed", { code: error.code }));
    throw agentError;
  }
}

/**
 * Booking services for the reservation assistant. Every call uses the
 * server-resolved businessId/conversationId; the model only supplies
 * validated values (dates, counts, room type names, quote ids it was given).
 */
async function reservationServices(
  admin: SupabaseClient<Database>,
  turn: {
    businessId: string;
    conversationId: string;
    customerMessageId: number;
    sources: KnowledgeSources;
    dryRun: boolean;
    source: "ai_website" | "ai_voice" | "ai_whatsapp";
  },
): Promise<ReservationServices> {
  const { data: roomTypes } = await admin
    .from("room_types")
    .select("id, name, description, maximum_guests, bed_configuration, amenities, base_price_cents, currency")
    .eq("business_id", turn.businessId)
    .eq("is_active", true)
    .order("base_price_cents");
  const types = roomTypes ?? [];
  const byName = (name: string) => types.find((t) => t.name.trim().toLowerCase() === name.trim().toLowerCase());
  const settings = (turn.sources.settings ?? {}) as { booking_settings?: Record<string, unknown>; policies?: Record<string, unknown> };
  const booking = settings.booking_settings ?? {};
  const policies = settings.policies ?? {};
  const describe = (t: (typeof types)[number]) => ({
    room_type: t.name,
    max_guests: t.maximum_guests,
    beds: t.bed_configuration,
    amenities: t.amenities,
    description: t.description ? sanitizeKnowledgeText(t.description) : null,
    base_price_per_night: formatCurrency(t.base_price_cents, t.currency),
  });
  const dbMessage = (message: string) => message.replace(/^.*?: /, "").slice(0, 200);

  return {
    async hotelInformation() {
      return {
        check_in_from: booking.check_in_time ?? null,
        check_out_by: booking.check_out_time ?? null,
        currency: booking.currency ?? null,
        max_nights: booking.max_nights ?? 30,
        free_cancellation_hours_before_check_in: booking.free_cancellation_hours ?? 48,
        cancellation_policy: typeof policies.cancellation === "string" ? sanitizeKnowledgeText(policies.cancellation) : null,
        room_types: types.map(describe),
      };
    },
    async roomDetails(name) {
      const t = byName(name);
      return t ? describe(t) : null;
    },
    async searchAvailability(checkIn, checkOut, guests) {
      const { data, error } = await admin.rpc("search_room_availability", {
        p_business_id: turn.businessId,
        p_check_in: checkIn,
        p_check_out: checkOut,
        p_guests: guests,
      });
      if (error) {
        if (error.code === "22023") return { error: dbMessage(error.message) };
        throw new Error("availability_failed");
      }
      return {
        results: (data ?? []).map((r) => ({
          room_type: r.name,
          max_guests: r.maximum_guests,
          available_rooms: r.available_rooms,
          nights: r.nights,
          total_price: formatCurrency(r.total_price_cents, r.currency),
        })),
      };
    },
    async quote(name, checkIn, checkOut, guests) {
      const t = byName(name);
      if (!t) return { available: false, reason: "room_type_not_found", room_types: types.map((x) => x.name) };
      const { data, error } = await admin.rpc("create_reservation_quote_service", {
        p_business_id: turn.businessId,
        p_conversation_id: turn.conversationId,
        p_message_id: turn.customerMessageId,
        p_room_type_id: t.id,
        p_check_in: checkIn,
        p_check_out: checkOut,
        p_guests: guests,
      });
      if (error) {
        if (error.code === "22023") return { available: false, reason: "invalid_request", message: dbMessage(error.message) };
        throw new Error("quote_failed");
      }
      const q = data as Record<string, unknown>;
      return q.available
        ? { ...q, total_price: formatCurrency(Number(q.total_price_cents), String(q.currency)) }
        : q;
    },
    async createReservation(input) {
      const { data, error } = await admin.rpc("create_reservation_service", {
        p_business_id: turn.businessId,
        p_conversation_id: turn.conversationId,
        p_customer_message_id: turn.customerMessageId,
        p_quote_id: input.quoteId,
        p_guest: { full_name: input.fullName, email: input.email, phone: input.phone },
        p_special_requests: input.specialRequests as string,
        p_source: turn.source as "ai_website",
        p_dry_run: turn.dryRun,
      });
      if (error) throw new Error("booking_failed");
      const result = data as Record<string, unknown> & { reservation?: { id?: string | null } };
      if (result.ok && !result.dry_run && !result.duplicate && result.reservation?.id) {
        // Only after the database committed the booking.
        const sent = await sendReservationEmail(admin, result.reservation.id, "confirmation");
        return { ...result, confirmation_email: sent.status === "sent" ? "sent" : "not_sent" };
      }
      return result;
    },
    async getReservation(reference, email) {
      const { data, error } = await admin.rpc("get_reservation_service", {
        p_business_id: turn.businessId,
        p_reference: reference,
        p_email: email,
      });
      if (error) throw new Error("lookup_failed");
      return data as Record<string, unknown>;
    },
    async requestCancellation(reference, email, reason) {
      if (turn.dryRun) {
        return { ok: true, dry_run: true, canceled: false, note: "Playground: cancellation requests are not executed." };
      }
      const { data, error } = await admin.rpc("request_cancellation_service", {
        p_business_id: turn.businessId,
        p_conversation_id: turn.conversationId,
        p_reference: reference,
        p_email: email,
        p_reason: reason as string,
      });
      if (error) throw new Error("cancellation_failed");
      const result = data as Record<string, unknown> & { reservation?: { id?: string } };
      if (result.canceled && result.reservation?.id) await sendReservationEmail(admin, result.reservation.id, "cancellation");
      return result;
    },
  };
}
