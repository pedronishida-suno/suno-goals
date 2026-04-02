-- =====================================================
-- MIGRATION 007 — RLS Recursion Fix + Schema Corrections
--
-- 1. Fix infinite recursion on public.users policies.
--    The original policies in schema.sql did:
--      EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
--    This queries the users table from WITHIN a users policy → infinite loop.
--    Fix: replace with get_my_role() which is SECURITY DEFINER and bypasses RLS.
--
-- 2. Add missing is_manager column to book_indicator_config.
--    schema.sql created the OLD book_indicators table (no is_manager).
--    migration 003 created book_indicator_config with is_manager, but if the table
--    already existed without the column, CREATE TABLE IF NOT EXISTS skipped it.
--
-- 3. Reload PostgREST schema cache so FK relationships are detected.
-- =====================================================

-- ── 1. Fix users table RLS policies ────────────────────────────────────────

DROP POLICY IF EXISTS "Admins can view all users"     ON public.users;
DROP POLICY IF EXISTS "Admins can insert users"       ON public.users;
DROP POLICY IF EXISTS "Admins can update users"       ON public.users;
-- Also drop the other recursive policy that queries users from within users RLS
DROP POLICY IF EXISTS "Admin full access on users"    ON public.users;

-- Use get_my_role() (SECURITY DEFINER) — queries users as postgres role, no RLS recursion
CREATE POLICY "Admins can view all users" ON public.users
  FOR SELECT USING (get_my_role() = 'admin');

CREATE POLICY "Admins can insert users" ON public.users
  FOR INSERT WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "Admins can update users" ON public.users
  FOR UPDATE USING (get_my_role() = 'admin');

-- ── 2. Ensure is_manager exists on book_indicator_config ───────────────────

ALTER TABLE public.book_indicator_config
  ADD COLUMN IF NOT EXISTS is_manager BOOLEAN DEFAULT false;

-- ── 3. Ensure books table has required columns (year, updated_at) ──────────
--    schema.sql books table was simpler; migration 001 adds year and owner_id FK.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS year INTEGER NOT NULL DEFAULT 2026;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── 4. Reload PostgREST schema cache ───────────────────────────────────────
--    Forces re-detection of FK relationships (users!manager_id, teams!manager_id, etc.)
NOTIFY pgrst, 'reload schema';
