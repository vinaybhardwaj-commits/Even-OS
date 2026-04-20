-- CHAT.X.6 — Real tasks table
--
-- Before: /task slash command only created a chat_messages row with
-- structured metadata (message_type='task'). There was no way to query
-- "show me all open tasks assigned to Dr. Bhardwaj" without scanning
-- every chat_message jsonb blob in the database.
--
-- After: /task dual-writes — chat_messages stays (for in-channel display
-- and retrograde compatibility), PLUS a structured row in `tasks` with
-- real columns + indexes. chat_message_id FK keeps the card in-context.
--
-- Deliberate deviations from the initial PRD schema (lines 309-332):
--   - chat_message_id INTEGER (not BIGINT) — chat_messages.id is SERIAL
--   - hospital_id TEXT REFERENCES hospitals(hospital_id) — matches the
--     codebase-wide convention (Even OS uses the human-readable hospital_id
--     column as the FK target, not hospitals.id uuid).
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS. Rollback: DROP TABLE tasks.

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL,
  hospital_id TEXT NOT NULL REFERENCES hospitals(hospital_id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id),
  assignee_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent','critical')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled','reassigned')),
  encounter_id UUID REFERENCES encounters(id),
  patient_id UUID REFERENCES patients(id),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  reassigned_from UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status
  ON tasks (assignee_id, status)
  WHERE status IN ('pending','in_progress');

CREATE INDEX IF NOT EXISTS idx_tasks_encounter
  ON tasks (encounter_id)
  WHERE encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_chat_message
  ON tasks (chat_message_id)
  WHERE chat_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_hospital_created
  ON tasks (hospital_id, created_at DESC);

COMMENT ON TABLE tasks IS
  'CHAT.X.6: structured task rows. /task creates a chat_messages row AND a tasks row; chat_message_id links them. Status-based index supports listMine(); encounter-based supports patient-chart Tasks tab.';
