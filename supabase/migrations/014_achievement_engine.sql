-- ============================================================================
-- Migration 014: Achievement Engine
--
-- Adds polarity-aware achievement calculation support:
-- 1. calculation_type on backoffice_indicators (soma/media/media_ponderada/valor_mais_recente)
-- 2. icp_ranges table for performance tier labels (Bronze/Silver/Gold)
-- 3. Drops generated percentage column on indicator_data (replaced by service layer)
-- 4. Adds stored percentage column (writable, computed by app)
--
-- Business rules ported from: suno-books achievement.py
-- ============================================================================

-- ── 1. Add calculation_type to backoffice_indicators ────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'backoffice_indicators'
      AND column_name = 'calculation_type'
  ) THEN
    ALTER TABLE public.backoffice_indicators
      ADD COLUMN calculation_type TEXT NOT NULL DEFAULT 'soma'
      CHECK (calculation_type IN ('soma', 'media', 'media_ponderada', 'valor_mais_recente'));
  END IF;
END $$;

COMMENT ON COLUMN public.backoffice_indicators.calculation_type IS
  'How monthly values accumulate: soma (sum), media (average), media_ponderada (weighted avg), valor_mais_recente (latest only)';

-- ── 2. Create icp_ranges table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.icp_ranges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_id UUID NOT NULL REFERENCES public.backoffice_indicators(id) ON DELETE CASCADE,
  min_pct NUMERIC(8,2) NOT NULL,
  max_pct NUMERIC(8,2),  -- NULL = unbounded upper range
  label TEXT NOT NULL,
  color TEXT,             -- hex color for UI display
  score NUMERIC(5,2),    -- optional numeric score for this tier
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icp_ranges_indicator ON public.icp_ranges(indicator_id);

COMMENT ON TABLE public.icp_ranges IS
  'Performance achievement tiers per indicator (e.g., Abaixo <80%, Na meta 80-100%, Acima >100%)';

-- RLS: authenticated can read, admin can write
ALTER TABLE public.icp_ranges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'icp_ranges'
      AND policyname = 'icp_ranges_select_authenticated'
  ) THEN
    CREATE POLICY icp_ranges_select_authenticated
      ON public.icp_ranges FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'icp_ranges'
      AND policyname = 'icp_ranges_admin_all'
  ) THEN
    CREATE POLICY icp_ranges_admin_all
      ON public.icp_ranges FOR ALL
      TO authenticated
      USING (public.get_my_role() IN ('admin', 'manager'))
      WITH CHECK (public.get_my_role() IN ('admin', 'manager'));
  END IF;
END $$;

-- ── 3. Replace generated percentage column with writable one ────────────────
--
-- The old generated column: CASE WHEN meta = 0 THEN 0 ELSE ROUND((real/meta)*100,0) END
-- This is WRONG for "down" polarity indicators. The new column is computed by
-- the application service layer using polarity-aware logic.

DO $$ BEGIN
  -- Check if percentage is a generated column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'indicator_data'
      AND column_name = 'percentage'
      AND is_generated = 'ALWAYS'
  ) THEN
    -- Drop the generated column
    ALTER TABLE public.indicator_data DROP COLUMN percentage;
    -- Re-add as a regular writable column
    ALTER TABLE public.indicator_data ADD COLUMN percentage NUMERIC DEFAULT 0;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'indicator_data'
      AND column_name = 'percentage'
  ) THEN
    -- Column doesn't exist at all, add it
    ALTER TABLE public.indicator_data ADD COLUMN percentage NUMERIC DEFAULT 0;
  END IF;
  -- If it exists and is NOT generated, leave it as-is (already writable)
END $$;

-- ── 4. Add icp_label column to indicator_data ───────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'indicator_data'
      AND column_name = 'icp_label'
  ) THEN
    ALTER TABLE public.indicator_data ADD COLUMN icp_label TEXT;
  END IF;
END $$;

-- ── 5. Reload PostgREST schema cache ────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
