-- CHAT.X.7 — Add `source` column to chat_audit_log
--
-- Before: every audit row required a human user_id + user_name, because
-- only the chat router called logAudit (all inside authed tRPC contexts).
--
-- After: system-orchestrated actions (patient channel lifecycle in
-- channel-manager.ts; clinical auto-events in auto-events.ts) will also
-- log. Those callers don't have an authenticated user in hand — the
-- channel is being created/archived by a transfer workflow, or a
-- vitals row is being auto-posted from an order. We want those rows
-- in the audit trail too, tagged with source='system' so we can tell
-- them apart from user-driven rows.
--
-- Change:
--   1. Drop NOT NULL from user_id + user_name.
--   2. Add `source TEXT NOT NULL DEFAULT 'user'` with CHECK constraint
--      (user | system | integration).
--   3. Add composite constraint: if source='user', user_id + user_name
--      must both be present. System/integration rows may have NULL actor.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; constraint add is guarded with
-- DO block checking pg_constraint.
-- Rollback: ALTER TABLE chat_audit_log ALTER COLUMN user_id SET NOT NULL;
--           ALTER TABLE chat_audit_log ALTER COLUMN user_name SET NOT NULL;
--           ALTER TABLE chat_audit_log DROP CONSTRAINT chk_audit_user_req;
--           ALTER TABLE chat_audit_log DROP COLUMN source;
--           (only safe after purging any system/integration rows first).

ALTER TABLE chat_audit_log ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE chat_audit_log ALTER COLUMN user_name DROP NOT NULL;

ALTER TABLE chat_audit_log
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user'
    CHECK (source IN ('user','system','integration'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_audit_user_req'
  ) THEN
    ALTER TABLE chat_audit_log
      ADD CONSTRAINT chk_audit_user_req
      CHECK (source <> 'user' OR (user_id IS NOT NULL AND user_name IS NOT NULL));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_chat_audit_source
  ON chat_audit_log (source, created_at DESC);

COMMENT ON COLUMN chat_audit_log.source IS
  'CHAT.X.7: user | system | integration. user rows require user_id+user_name; system/integration may have NULL actor (channel lifecycle, auto-events, HL7 inbound).';
