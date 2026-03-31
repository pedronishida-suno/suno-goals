-- =====================================================
-- MIGRATION 004 — Monday Sync Log + Users monday_item_id
-- Run AFTER 001_phase1.sql, 002_monday_sync.sql, 003_apply_missing_schema.sql
-- =====================================================

-- 1. Add monday_item_id to users for stable matching from COLABORADORES board
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS monday_item_id BIGINT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_monday_item_id
  ON public.users(monday_item_id);

-- 2. Sync run audit log — tracks every Monday ↔ Supabase sync operation
CREATE TABLE IF NOT EXISTS public.monday_sync_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sync_type     TEXT NOT NULL
                  CHECK (sync_type IN (
                    'catalog', 'indicator_data', 'colaboradores',
                    'resultado_books', 'webhook'
                  )),
  board_id      BIGINT,
  triggered_by  TEXT,            -- 'service', 'webhook', or user UUID string
  status        TEXT NOT NULL DEFAULT 'started'
                  CHECK (status IN ('started', 'success', 'partial', 'error')),
  items_fetched INTEGER,
  items_synced  INTEGER,
  items_skipped INTEGER,
  error_detail  TEXT,
  metadata      JSONB DEFAULT '{}'::jsonb,
  started_at    TIMESTAMPTZ DEFAULT NOW(),
  finished_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_monday_sync_log_type
  ON public.monday_sync_log(sync_type);
CREATE INDEX IF NOT EXISTS idx_monday_sync_log_started
  ON public.monday_sync_log(started_at DESC);

-- 3. RLS — admins can read/write; service role bypasses automatically
ALTER TABLE public.monday_sync_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'monday_sync_log'
      AND policyname = 'Admins manage sync log'
  ) THEN
    CREATE POLICY "Admins manage sync log"
      ON public.monday_sync_log
      FOR ALL
      USING (
        (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin'
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
