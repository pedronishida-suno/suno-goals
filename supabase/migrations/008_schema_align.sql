-- =====================================================
-- MIGRATION 008 — Align live DB with migration definitions
--
-- The live DB was created from schema.sql (base) before several migrations
-- added columns. This migration idempotently adds all missing columns,
-- FKs, and fixes the indicator_data read path.
-- =====================================================

-- ── 1. public.users — add all missing columns ─────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS manager_id  UUID,
  ADD COLUMN IF NOT EXISTS team_id     UUID,
  ADD COLUMN IF NOT EXISTS department  TEXT,
  ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_login  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by  UUID;

-- FK: users.manager_id → users.id (self-reference)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_manager_id_fkey' AND table_name = 'users'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_manager_id_fkey
      FOREIGN KEY (manager_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- FK: users.team_id → teams.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_team_id_fkey' AND table_name = 'users'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
  END IF;
END $$;

-- FK: users.created_by → users.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_created_by_fkey' AND table_name = 'users'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes for new FK columns
CREATE INDEX IF NOT EXISTS idx_users_manager  ON public.users(manager_id);
CREATE INDEX IF NOT EXISTS idx_users_team     ON public.users(team_id);

-- ── 2. book_indicator_config — add missing custom_* goal columns ───────────

ALTER TABLE public.book_indicator_config
  ADD COLUMN IF NOT EXISTS book_id      UUID,
  ADD COLUMN IF NOT EXISTS indicator_id UUID,
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS custom_jan   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_feb   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_mar   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_apr   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_may   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_jun   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_jul   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_aug   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_sep   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_oct   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_nov   NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS custom_dec   NUMERIC DEFAULT NULL;

-- FK: book_indicator_config.book_id → books.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'book_indicator_config_book_id_fkey' AND table_name = 'book_indicator_config'
  ) THEN
    ALTER TABLE public.book_indicator_config
      ADD CONSTRAINT book_indicator_config_book_id_fkey
      FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;
  END IF;
END $$;

-- FK: book_indicator_config.indicator_id → backoffice_indicators.id
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'book_indicator_config_indicator_id_fkey' AND table_name = 'book_indicator_config'
  ) THEN
    ALTER TABLE public.book_indicator_config
      ADD CONSTRAINT book_indicator_config_indicator_id_fkey
      FOREIGN KEY (indicator_id) REFERENCES public.backoffice_indicators(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_book_indicator_config_book      ON public.book_indicator_config(book_id);
CREATE INDEX IF NOT EXISTS idx_book_indicator_config_indicator ON public.book_indicator_config(indicator_id);

-- ── 3. indicator_data — add percentage + updated_by ───────────────────────

ALTER TABLE public.indicator_data
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id);

-- percentage as a stored generated column (skip if already exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'indicator_data' AND column_name = 'percentage'
  ) THEN
    ALTER TABLE public.indicator_data
      ADD COLUMN percentage NUMERIC GENERATED ALWAYS AS (
        CASE WHEN meta = 0 THEN 0 ELSE ROUND((real / meta) * 100, 0) END
      ) STORED;
  END IF;
END $$;

-- ── 4. Drop duplicate partial index (keep indicator_data_system_key) ───────

DROP INDEX IF EXISTS idx_indicator_data_global;

-- ── 5. books — ensure FK to users ─────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'books_owner_id_fkey' AND table_name = 'books'
  ) THEN
    ALTER TABLE public.books
      ADD CONSTRAINT books_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 6. Reload PostgREST schema cache ───────────────────────────────────────

NOTIFY pgrst, 'reload schema';
