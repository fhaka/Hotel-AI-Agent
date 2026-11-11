import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { readAgentConfig } from "@/lib/agents/config";
import type { CurrentUser } from "@/lib/auth/session";
import { formatInZone } from "@/lib/billing/trial";
import { checkAgentExecution } from "@/lib/entitlements/evaluate";
import { EntitlementError, getBusinessEntitlements } from "@/lib/entitlements/service";
import { formatCurrency, formatKnowledgeContext, sanitizeKnowledgeText, type KnowledgeSources } from "@/lib/knowledge/context";
import { sendReservationEmail } from "@/lib/reservations/notify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ReservationServices } from "./reservation-tools";
import { loadKnowledgeSources } from "@/lib/knowledge/load";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AgentError, fromTurnReason } from "./errors";
import { runToolLoop, type TurnResult } from "./loop";
import { createOpenAIModel } from "./openai-model";
import { buildInstructions } from "./prompt";
import { toolsFor, type ToolContext } from "./tools";
import type { ChatMessage, ModelClient } from "./types";

export const MAX_MESSAGE_CHARS = 2000;
const HISTORY_MESSAGES = 20;
const TURN_TIMEOUT_MS = 90_000;
const RATE_LIMITS = [
  { scope: "user", limit: 20, windowSeconds: 60 },
  { scope: "business", limit: 120, windowSeconds: 60 },
] as const;

export type PlaygroundTurnResult = {
  conversationId: string;
  reply: string;
  escalated: boolean;
  toolEvents: TurnResult["toolEvents"];
  usage: { messagesUsed: number | null; messagesLimit: number | null };
};

/**
 * One playground turn for a signed-in staff member.
 *
 * Authorization chain:
 *   1. identity from the verified session (caller passes CurrentUser from the DAL)
 *   2. the agent is looked up with the USER's client: RLS proves membership,
 *      and the business id is taken from that row — never from the request
 *   3. getBusinessEntitlements + checkAgentExecution (role, plan, trial, usage, agent)
 *   4. rate limits per user and per business
 *   5. begin_agent_turn(): final atomic check under a per-business lock,
 *      usage reservation, conversation ownership, customer message stored
 * Only then is the model called. Writes use the service role, always with the
 * server-resolved business id.
 */
export async function runPlaygroundTurn(
  input: { user: CurrentUser; agentId: string; conversationId: string | null; message: string },
  deps: { model?: ModelClient } = {},
): Promise<PlaygroundTurnResult> {
  const message = input.message.trim();
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    throw new AgentError("invalid_request", `Messages must be between 1 and ${MAX_MESSAGE_CHARS} characters.`);
  }
  if (!process.env.SUPABASE_SECRET_KEY) throw new AgentError("not_configured");
  const model = deps.model ?? createOpenAIModel();

  const userClient = await createClient();
  const { data: agent } = await userClient
    .from("agents")
    .select("id, business_id, agent_type, name, system_configuration")
    .eq("id", input.agentId)
    .maybeSingle();
  if (!agent) throw new AgentError("not_found");
  const businessId = agent.business_id;

  let decision;
  try {
    const ent = await getBusinessEntitlements(businessId, input.user);
    decision = checkAgentExecution(ent.snapshot, agent.agent_type);
  } catch (err) {
    if (err instanceof EntitlementError && err.code === "not_member") throw new AgentError("not_member");
    throw new AgentError("internal_error");
  }
  if (!decision.allowed) throw new AgentError(decision.code, decision.message);

  const admin = createAdminClient();
  for (const rl of RATE_LIMITS) {
    const key = `agent:${rl.scope}:${rl.scope === "user" ? input.user.id : businessId}`;
    const { data: ok, error } = await admin.rpc("consume_rate_limit", { p_key: key, p_limit: rl.limit, p_window_seconds: rl.windowSeconds });
    if (error) throw new AgentError("internal_error");
    if (!ok) throw new AgentError("rate_limited");
  }

  const { data: begun, error: beginError } = await admin.rpc("begin_agent_turn", {
    p_business_id: businessId,
    p_agent_id: agent.id,
    p_channel: "playground",
    // null = start a new conversation. The generated types don't model
    // nullable SQL parameters, but PostgREST passes JSON null through.
    p_conversation_id: input.conversationId as string,
    p_started_by: input.user.id,
    p_customer_message: message,
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
      { role: "user", content: message },
    ];

    const ctx: ToolContext = {
      businessId,
      conversationId: turn.conversation_id,
      agentId: agent.id,
      escalationMessage: config.escalation_message || null,
      services: {
        async searchKnowledge(query) {
          const { data, error } = await admin.rpc("search_agent_knowledge", {
            p_business_id: businessId,
            p_query: query,
            p_limit: 5,
            p_offset: 0,
          });
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
          agent.agent_type === "reservation_assistant"
            ? await reservationServices(admin, {
                businessId,
                conversationId: turn.conversation_id,
                customerMessageId: turn.customer_message_id,
                sources,
                dryRun: true, // playground: bookings are validated but never saved
              })
            : undefined,
      },
    };

    const result = await runToolLoop({
      // References/numbers from earlier messages and the business's own
      // knowledge (e.g. its phone number) are known; only invented ones are blocked.
      priorText: [...(past ?? []).map((m) => m.content), knowledge.text],
      model,
      instructions: buildInstructions({
        agentType: agent.agent_type,
        agentName: agent.name,
        businessName: sources.business.name,
        industry: sources.business.industry,
        languages: sources.business.supported_languages,
        defaultLanguage: sources.business.default_language,
        config,
        knowledgeBlock: knowledge.text,
        channel: "playground",
        localTime: formatInZone(new Date(), sources.business.timezone),
        timezone: sources.business.timezone,
        canary,
      }),
      messages,
      tools: toolsFor(agent.agent_type),
      ctx,
      canary,
      safetyIdentifier: createHash("sha256").update(`hotelai:${input.user.id}`).digest("hex").slice(0, 32),
      signal: AbortSignal.timeout(TURN_TIMEOUT_MS),
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
  turn: { businessId: string; conversationId: string; customerMessageId: number; sources: KnowledgeSources; dryRun: boolean },
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
        p_source: "ai_website",
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
