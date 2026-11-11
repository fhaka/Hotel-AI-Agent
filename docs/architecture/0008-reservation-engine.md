# ADR 0008 — Reservation engine and AI booking protocol

**Status:** accepted · 2026-11-16

## Source of truth

PostgreSQL owns inventory, availability, prices and reservations. Neither the browser nor the AI
can insert or freely update reservations. Members may only edit `special_requests` directly;
everything else goes through these functions:

| Function | Caller | Purpose |
|---|---|---|
| `search_room_availability` | members (RLS), service | Free rooms per active type + total stay price |
| `create_reservation` | members | Staff booking (requires active plan/trial) |
| `modify_reservation` | members | New dates/guests, price recalculated, room re-allocated if needed |
| `update_reservation_status` | members | Enforced transitions; check-in/no-show only once the stay started |
| `cancel_reservation` | members | Cancel with reason |
| `create_reservation_quote_service` | service | AI quote (30 min) |
| `create_reservation_service` | service | AI booking from a quote (or dry run) |
| `get_reservation_service` | service | Guest lookup: reference **and** email |
| `request_cancellation_service` | service | Cancel if allowed by the hotel's rules, else hand to staff |
| `log_reservation_email` | members, service | Email outcomes in the history |

## Rules

- **Validation:** check-out > check-in; check-in not in the past (business time zone); at most 365
  days ahead; stay ≤ `booking_settings.max_nights` (default 30); party size ≤ the room type's maximum.
- **Price:** the sum of nightly prices, where each night is the seasonal rate covering that night or
  the base price. Seasonal rates can't overlap (exclusion constraint). Always computed in the
  database; clients and the AI never supply prices.
- **Allocation:** try each free room of the type in room-number order. If a concurrent booking
  wins a room, the insert hits the `reservations_no_overlap` exclusion constraint and the next room
  is tried. When none is left: `23P01` (sold out). Tested: 6 concurrent bookings for 2 rooms → 2
  succeed.
- **Guests:** matched by email within the business, otherwise created.
- **Idempotency:** `(business_id, idempotency_key)` is unique. The staff form sends one key per
  form instance; AI bookings use `quote:<id>`.
- **History:** a trigger writes `reservation_events` (created / status_changed / modified), and
  email sends are logged. Every reservation is also in the audit log.

## AI booking protocol (enforced by the database)

1. `search_room_availability` → `calculate_booking_price` creates a **quote** tied to the
   conversation and the customer message of that turn.
2. `create_reservation(quote_id)` succeeds only if:
   - the quote belongs to this business **and** conversation;
   - it is unexpired;
   - the guest has sent a **newer message** than the one that produced the quote (they saw the
     price and replied);
   - the price is unchanged.
   Repeating the call returns the same reservation.
3. Only a `confirmation_reference` returned by a tool counts. The reply guard blocks any
   10-character reference the reply contains that no tool returned and that wasn't in the
   conversation or the business's own knowledge.
4. Confirmation emails are sent only after the booking function has committed.

**Playground:** `p_dry_run = true` runs the complete booking (validation, guest, allocation)
inside a sub-transaction and then rolls it back. The agent gets a `TEST-` reference, and nothing
is stored or blocked. Cancellation requests are not executed in the playground.

## Cancellation policy

`booking_settings.ai_can_cancel` (default off) and `free_cancellation_hours` (default 48, counted
from check-in date + check-in time in the business time zone). The AI cancels only when both
allow it; otherwise the conversation is escalated to staff. Staff can always cancel.

## UI

- Reservations: list with filters, three-step creation, detail page with actions and history.
- Calendar: rooms × 14 nights.
- Rooms: types, rooms, statuses, seasonal rates.
- Guests: search, profile, booking history.
- Overview: arrivals, departures, in-house, occupancy tonight, upcoming bookings, AI bookings.

## Not included (yet)

Multi-room bookings in one reservation, deposits/payments, external calendar/channel-manager sync,
and reminder emails (Phase 8).
