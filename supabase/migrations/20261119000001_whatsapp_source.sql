-- =============================================================================
-- HotelAI — Migration 12: reservation source for WhatsApp bookings.
-- Separate file: a new enum value can't be used in the transaction that adds it.
-- =============================================================================
alter type public.reservation_source add value if not exists 'ai_whatsapp';
