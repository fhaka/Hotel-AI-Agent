# ADR 0002 — Multi-tenancy and Row Level Security

**Status:** accepted · 2026-11-11

## Model

- A **business** is the tenant. Users join businesses through `business_members` with a role
  (`owner`, `admin`, `manager`, `staff`) and an `invitation_status`. Only `active` memberships grant access.
- Every tenant-owned table has a `business_id` column.
- One user may belong to many businesses. The *active* business will be chosen in the UI (Phase 2),
  but the chosen id is only a hint: it is always re-validated against membership on the server
  and by RLS in the database.

## Enforcement

- **RLS is enabled on every table in `public`.** A test (`tests/db/tenancy.test.ts → RLS coverage`)
  fails if any table is added without it.
- **Explicit grants** per table and, where relevant, per column. We do not rely on platform default
  privileges. `anon` has no access to tenant tables.
- **Helper functions** `private.is_business_member()` and `private.has_business_role()` are
  `SECURITY DEFINER`, `STABLE`, with `search_path = ''`, and only answer questions about
  `auth.uid()`. They live in the `private` schema, which the Supabase Data API does not expose.
- **Composite foreign keys** `(business_id, parent_id)` make it impossible to link a row in one
  business to a parent row in another business (e.g. a reservation pointing at another hotel's room),
  even for code running with the service role.
- **Sensitive writes go through functions** rather than direct table access:
  - `create_business_workspace()` — the only way to create a tenant.
  - `update_member_role()` / `remove_business_member()` — enforce the role hierarchy
    (only owners manage owners/admins) and the "at least one owner" invariant.
- **Audit log** (`audit_logs`) is append-only (update trigger raises) and only readable by owners/admins.

## Role capabilities (current)

| Capability | owner | admin | manager | staff |
|---|:-:|:-:|:-:|:-:|
| Read business data | ✓ | ✓ | ✓ | ✓ |
| Edit business profile & settings | ✓ | ✓ | | |
| Manage owners/admins | ✓ | | | |
| Manage managers/staff | ✓ | ✓ | | |
| Configure agents | ✓ | ✓ | | |
| Edit knowledge base | ✓ | ✓ | ✓ | |
| Configure rooms / rates | ✓ | ✓ | ✓ | |
| Guests & reservations (create/update) | ✓ | ✓ | ✓ | ✓ |
| Read audit log & usage details | ✓ | ✓ | | |

## Service role usage rules

The secret key bypasses RLS. It may be used only in trusted server code (verified webhooks,
background jobs, the agent runtime after its own entitlement checks). Such code must scope every
query by a `business_id` derived on the server — never from a request body or an AI tool argument.
