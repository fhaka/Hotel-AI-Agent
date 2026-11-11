import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RenderedEmail } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";
import { formatInZone } from "@/lib/billing/trial";
import { formatStayDate, todayInZone } from "@/lib/reservations/dates";
import type { Database } from "@/lib/supabase/database.types";
import {
  dailyReportEmail,
  escalationEmail,
  paymentFailedEmail,
  preArrivalEmail,
  trialEndedEmail,
  trialEndingEmail,
  welcomeEmail,
} from "./templates";

type Admin = SupabaseClient<Database>;
export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
export type RenderResult = { action: "send"; email: RenderedEmail } | { action: "skip"; reason: string };

/**
 * Builds the email for a queued notification from CURRENT data (service-role
 * client, always scoped by the row's business_id). If the situation changed
 * since it was queued (booking canceled, hand-over resolved, plan paid), the
 * notification is skipped instead of sending stale information.
 */
export async function renderNotification(admin: Admin, n: NotificationRow): Promise<RenderResult> {
  const { data: business } = await admin
    .from("businesses")
    .select("name, industry, timezone, address, city, phone, contact_email")
    .eq("id", n.business_id)
    .maybeSingle();
  if (!business) return { action: "skip", reason: "business_not_found" };
  const tz = business.timezone;

  switch (n.kind) {
    case "guest_pre_arrival": {
      const { data: r } = await admin
        .from("reservations")
        .select("status, check_in, check_out, confirmation_reference, guests ( full_name, email ), rooms ( room_types ( name ) )")
        .eq("id", n.subject_id ?? "")
        .eq("business_id", n.business_id)
        .maybeSingle();
      if (!r || r.status !== "confirmed") return { action: "skip", reason: "reservation_not_confirmed" };
      if (r.check_in < todayInZone(tz)) return { action: "skip", reason: "stay_already_started" };
      const guest = r.guests as unknown as { full_name: string; email: string | null } | null;
      if (!guest?.email || guest.email.toLowerCase() !== n.recipient_email) return { action: "skip", reason: "guest_email_changed" };
      const { data: s } = await admin.from("business_settings").select("booking_settings").eq("business_id", n.business_id).single();
      const booking = (s?.booking_settings ?? {}) as { check_in_time?: string };
      return {
        action: "send",
        email: preArrivalEmail({
          businessName: business.name,
          guestName: guest.full_name,
          reference: r.confirmation_reference,
          checkIn: formatStayDate(r.check_in),
          checkOut: formatStayDate(r.check_out),
          roomType: (r.rooms as unknown as { room_types: { name: string } | null } | null)?.room_types?.name ?? "Room",
          checkInTime: booking.check_in_time ?? null,
          address: [business.address, business.city].filter(Boolean).join(", ") || null,
          phone: business.phone,
          email: business.contact_email,
        }),
      };
    }
    case "owner_trial_ending":
    case "owner_trial_ended":
    case "owner_payment_failed": {
      const { data: sub } = await admin.from("subscriptions").select("status, trial_ends_at, provider_subscription_id").eq("business_id", n.business_id).single();
      const billingUrl = appUrl("/dashboard/billing");
      if (n.kind === "owner_payment_failed") {
        return sub?.status === "past_due" ? { action: "send", email: paymentFailedEmail({ businessName: business.name, billingUrl }) } : { action: "skip", reason: "payment_recovered" };
      }
      if (sub?.provider_subscription_id) return { action: "skip", reason: "already_subscribed" };
      if (n.kind === "owner_trial_ending") {
        if (sub?.status !== "trialing" || !sub.trial_ends_at) return { action: "skip", reason: "not_trialing" };
        return { action: "send", email: trialEndingEmail({ businessName: business.name, endsAt: formatInZone(new Date(sub.trial_ends_at), tz), billingUrl }) };
      }
      return { action: "send", email: trialEndedEmail({ businessName: business.name, billingUrl }) };
    }
    case "staff_escalation":
    case "staff_unanswered_inquiry": {
      const { data: c } = await admin
        .from("agent_conversations")
        .select("id, status, escalated_at, escalation")
        .eq("id", n.subject_id ?? "")
        .eq("business_id", n.business_id)
        .maybeSingle();
      if (!c || c.status !== "escalated") return { action: "skip", reason: "already_handled" };
      const e = (c.escalation ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null);
      return {
        action: "send",
        email: escalationEmail({
          businessName: business.name,
          unanswered: n.kind === "staff_unanswered_inquiry",
          hoursOpen: c.escalated_at ? Math.max(1, Math.round((Date.now() - Date.parse(c.escalated_at)) / 3_600_000)) : 0,
          reason: str(e.reason) ?? "The assistant could not help with this request.",
          customerName: str(e.customer_name),
          customerEmail: str(e.customer_email),
          customerPhone: str(e.customer_phone),
          conversationUrl: appUrl(`/dashboard/conversations/${c.id}`),
        }),
      };
    }
    case "owner_daily_report": {
      const today = todayInZone(tz);
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const [active, newBookings, aiBookings, convs, escalations, ent] = await Promise.all([
        admin.from("reservations").select("check_in, check_out, status").eq("business_id", n.business_id).in("status", ["confirmed", "checked_in", "checked_out"]).lte("check_in", today).gte("check_out", today),
        admin.from("reservations").select("id", { count: "exact", head: true }).eq("business_id", n.business_id).gte("created_at", since),
        admin.from("reservations").select("id", { count: "exact", head: true }).eq("business_id", n.business_id).gte("created_at", since).in("source", ["ai_website", "ai_voice"]),
        admin.from("agent_conversations").select("id", { count: "exact", head: true }).eq("business_id", n.business_id).neq("channel", "playground").gte("created_at", since),
        admin.from("agent_conversations").select("id", { count: "exact", head: true }).eq("business_id", n.business_id).eq("status", "escalated"),
        admin.rpc("get_business_entitlements_service", { p_business_id: n.business_id }),
      ]);
      const rows = active.data ?? [];
      const e = (ent.data ?? {}) as { usage?: { ai_messages?: number }; limits?: { ai_messages_per_month?: number } };
      return {
        action: "send",
        email: dailyReportEmail({
          businessName: business.name,
          dashboardUrl: appUrl("/dashboard"),
          isHotel: business.industry === "hotel",
          report: {
            date: formatStayDate(today),
            arrivals: rows.filter((r) => r.check_in === today).length,
            departures: rows.filter((r) => r.check_out === today).length,
            inHouse: rows.filter((r) => r.status === "checked_in").length,
            newBookings24h: newBookings.count ?? 0,
            aiBookings24h: aiBookings.count ?? 0,
            conversations24h: convs.count ?? 0,
            openEscalations: escalations.count ?? 0,
            aiMessagesUsed: Number(e.usage?.ai_messages ?? 0),
            aiMessagesLimit: e.limits?.ai_messages_per_month ?? null,
          },
        }),
      };
    }
    case "owner_welcome":
      return { action: "send", email: welcomeEmail({ businessName: business.name, dashboardUrl: appUrl("/dashboard") }) };
    default:
      return { action: "skip", reason: "unknown_kind" };
  }
}
