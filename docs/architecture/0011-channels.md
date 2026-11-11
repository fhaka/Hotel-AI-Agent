# ADR 0011 — Customer channels: website widget, phone, WhatsApp

**Status:** accepted (code) · live calls/messages not yet tested · 2026-11-19

## Decision

- **One runtime for every channel.** `executeTurn()` is the shared core:
  - it calls `begin_agent_turn`, which re-checks entitlements on the DB clock, reserves usage and
    binds the conversation;
  - it adds knowledge, platform rules and tools;
  - it ends with `complete_agent_turn` or `fail_agent_turn`.

  The two entry points:
  - `runPlaygroundTurn`: signed-in member, role check, test (dry-run) bookings.
  - `runChannelTurn`: business resolved from a trusted source, no role, real bookings.
- **Provider for phone and WhatsApp: Twilio.** Speech is processed turn by turn with
  `<Gather input="speech">`, the reply goes through our runtime, and it is spoken back with
  `<Say>`. The rules, tools and booking protocol are therefore identical to chat.

  Managed voice-agent platforms (Vapi, Retell) were not chosen: they bring their own LLM
  orchestration, which would duplicate or bypass these guarantees. Trade-off: higher latency
  per turn, and the language set is limited to Twilio's built-in voices.
- **API verification:** Twilio's API was verified against the official `twilio` SDK (v6) types.
  The voice-language list is type-checked against the SDK's recognition **and** speech unions;
  adding Albanian fails compilation.

## Trust and routing

| Channel | Who is the tenant? | Who is the visitor? | Protection |
|---|---|---|---|
| Widget | `business_channels.public_key` (not secret) | random token per browser; DB stores `sha256` | rate limits per IP-hash/visitor/business; plan usage limits; CSP `frame-ancestors` from allowed origins (fail-closed); same-origin API |
| Phone | Twilio `To` number → operator-assigned `business_channels.address` | `CallSid` | Twilio signature (SDK `validateRequest`) over the canonical URL; per-call and per-business rate limits; voice-minute limit |
| WhatsApp | same, kind `whatsapp` | HMAC of the sender number (raw number not stored) | Twilio signature; per-sender and per-business rate limits |

- **Number assignment:** only the operator (service role) can assign a number to a business,
  so owners can't claim another business's line. A number is unique per channel kind.
- **Conversation binding:** on public channels a conversation can only be continued with the
  same external reference (`begin_agent_turn` v2, tested).
- **TwiML is generated with the SDK,** so model output is XML-escaped and can never inject
  `<Dial>` or other verbs (tested).
- **AI disclosure:** spoken at the start of every call; shown permanently in the widget.

## Usage and follow-up

- Voice minutes are recorded once per call (`record_voice_call`, with a unique index on the
  call id), and calls are refused once the plan's minutes are used up.
- After a call, `staff_call_summary` notifications go out via the Phase 8 outbox. A hand-over
  with a configured transfer number forwards the call.

## Not included

External TTS for unsupported languages, streaming/real-time voice, inbound media on WhatsApp,
outbound WhatsApp templates (proactive messages), and number purchasing from the dashboard
(the operator admin area comes in Phase 10).
