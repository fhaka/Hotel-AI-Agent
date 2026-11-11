# ADR 0006 — Knowledge base and agent knowledge context

**Status:** accepted · 2026-11-14

## Where knowledge lives

| Information | Stored in | Edited at |
|---|---|---|
| Business profile | `businesses` | Business → Profile |
| Hours, policies, hotel facts, check-in/out | `business_settings` | Business → Hours/Hotel |
| Room types (descriptive, base price) | `room_types` | Business → Hotel & rooms (later: Rooms page) |
| FAQs, services, prices, extra policies, facility hours, hotel info, about, other | `agent_knowledge` | Knowledge base |

Structured facts stay structured (no duplication into free text). The knowledge base is for
everything else. Entries created by onboarding are marked `source_type = 'onboarding'` and appear in
both places.

## Database rules

- RLS: all members read; owner/admin/manager create/edit/delete.
- Clients can update only `title`, `content`, `category`. `created_by` is set by trigger, and
  direct client inserts are forced to `source_type = 'manual'`.
- Limits per business (configurable in `platform_settings.knowledge`): 500 entries and 300,000
  characters, enforced by a trigger under a per-business lock.
- `search_agent_knowledge()` is `SECURITY INVOKER` (RLS applies) and matches with `position()`, so
  search text is never interpreted as filter syntax or wildcards. Page size clamped to 1–100.
- Create/update/delete are audited with category and changed column names, never content.

## Agent context (`src/lib/knowledge`)

`loadKnowledgeSources(client, businessId)` loads one business's data. Every query filters by
`business_id`. With a user client, RLS also applies; with the service-role client (public
channels, Phase 5) the business id must be resolved server-side.

`formatKnowledgeContext()` (pure, unit-tested) builds a single
`<business_knowledge> … </business_knowledge>` block:

1. profile, hours, stay details, policies, room types (always first)
2. knowledge entries by priority: FAQ → policies → prices → services → hours → hotel → about → other

Properties:
- **Budget:** default 24,000 characters. Entries that don't fit are omitted whole (never cut
  mid-sentence), and the omission is reported. The preview page shows owners exactly what agents
  receive and warns when something doesn't fit.
- **Delimiter neutralization:** any text resembling the opening or closing tag is replaced, so
  stored content cannot close the data block. Control characters are stripped.
- **No availability claims:** room types state base prices only, with an explicit note that
  availability and final prices come from the booking tools.

The Phase 5 system prompt must state that the block is reference data, not instructions.

## Deferred: document upload

Uploading PDFs/DOCX to a private Storage bucket is deferred until text extraction (and a review
step) exists. Storing files the agents cannot use would be a non-functional feature. When it's
added: private bucket, per-business path prefix with storage RLS, MIME/size allow-list, extracted
text treated as untrusted and stored as `source_type = 'document'` entries.
