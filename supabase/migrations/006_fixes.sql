-- =====================================================
-- MIGRATION 006 — Bug Fixes
--
-- 1. Add responsible_people JSONB column to backoffice_indicators
--    (synced from Monday.com multiple_person column)
-- 2. Fix indicator_data RLS: add missing SELECT policy so authenticated
--    users can read indicator_data via user JWT (server-side).
--    Writes are handled by the service-role client (bypasses RLS),
--    so no INSERT/UPDATE policies are needed here.
-- =====================================================

-- 1. responsible_people column
ALTER TABLE public.backoffice_indicators
  ADD COLUMN IF NOT EXISTS responsible_people JSONB DEFAULT '[]';

-- 2. indicator_data SELECT policy (was missing — caused empty dashboard data)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'indicator_data'
      AND policyname = 'Authenticated can read indicator data'
  ) THEN
    CREATE POLICY "Authenticated can read indicator data"
      ON public.indicator_data
      FOR SELECT
      USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
