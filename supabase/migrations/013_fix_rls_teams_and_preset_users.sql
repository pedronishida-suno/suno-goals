-- =====================================================
-- MIGRATION 013 — Fix RLS policies for decoupled users
--               + unique index on teams.name for sync upserts
--
-- After migration 012, public.users.id is no longer the auth UUID.
-- Any RLS policy that does  `id = auth.uid()`  now fails.
-- Teams policies were created in migration 001 before get_my_role() existed.
-- =====================================================

-- 1. Fix teams RLS — replace id=auth.uid() with get_my_role()
DROP POLICY IF EXISTS "Admins can manage teams" ON public.teams;
CREATE POLICY "Admins can manage teams" ON public.teams
  FOR ALL USING (get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage team members" ON public.team_members;
CREATE POLICY "Admins can manage team members" ON public.team_members
  FOR ALL USING (get_my_role() = 'admin');

-- 2. Unique index on teams.name so sync can upsert by name
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_name_unique
  ON public.teams(lower(name));

-- 3. Add monday_diretoria column to teams so we can track origin
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS monday_diretoria TEXT;

NOTIFY pgrst, 'reload schema';
