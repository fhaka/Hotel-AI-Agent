# ADR 0004 — Onboarding wizard and active workspace

**Status:** accepted · 2026-11-12

## Onboarding

| Step | Route | Database call | Who |
|---|---|---|---|
| 1. Company | `/onboarding` (create) · `/onboarding/:id/company` (edit) | `create_business_workspace()` · direct `UPDATE businesses` (RLS) | any signed-in user · owner/admin |
| 2. Operations | `/onboarding/:id/operations` | `save_onboarding_operations()` | owner/admin |
| 3. Hotel & rooms (hotels only) | `/onboarding/:id/hotel` | `save_onboarding_hotel()` | owner/admin |
| 4. Review | `/onboarding/:id/review` | `complete_onboarding()` | owner/admin |

Decisions:

- **Step 1 creates the workspace**, so the 7-day trial starts exactly when the workspace exists, and
  every later step saves into it. That is how progress is saved and resumable (`/onboarding/:id`
  redirects to the first unfinished step).
- **Each step is one SQL function = one transaction.** A failed save never leaves half-written data
  (tested: a duplicate room number leaves the previous inventory intact).
- The functions are `SECURITY DEFINER` and call `private.assert_business_admin()` first. The
  business id comes from the URL; it is only used after that check.
- `onboarding_state` / `onboarding_completed_at` are not client-writable, so a user can't skip
  required steps by editing requests.
- Where data lives:
  - hours → `business_settings.opening_hours`
  - policies and hotel facts (cancellation, breakfast, parking, Wi-Fi, pets, extras, contact
    instructions) → `business_settings.policies`
  - check-in/out, currency → `business_settings.booking_settings`
  - services and FAQs → `agent_knowledge` with `source_type = 'onboarding'` (re-saving replaces
    only these; manual knowledge entries are untouched)
  - room types and rooms → `room_types`, `rooms`
- Room inventory is replaced wholesale from the wizard, which is only allowed while the business
  has **no reservations** (`55006` otherwise). Afterwards rooms are managed from the Rooms page
  (Phase 6). Seasonal rates are also managed there, to keep onboarding short.
- Industry is fixed after creation (not in the column grants), because it determines agents and steps.
- The same validation runs in two places: Zod in the Server Action (friendly field errors) and
  database constraints/functions (authority). `src/lib/onboarding/rpc-args.ts` is shared by the
  actions and the contract test so the mapping between them is tested.

## Active workspace

- Stored in an httpOnly cookie `hotelai_workspace`. It is a **preference, not a permission**:
  `getActiveWorkspace()` intersects it with the user's active memberships and falls back to the
  first workspace for a stale or forged id.
- Switching is a POST Server Action that re-checks membership before setting the cookie.
- Pages that act on a specific business (e.g. onboarding) take the id from the URL and authorize it
  independently; they do not depend on the cookie.
