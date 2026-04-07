-- =====================================================
-- MIGRATION 012 — Decouple public.users from auth.users
--
-- Previously, public.users.id was a FK to auth.users(id),
-- meaning you could NOT create a user row without an auth account.
-- This blocked pre-populating users from Monday sync.
--
-- Changes:
--   1. Add auth_id UUID (the link to Supabase auth — null until login)
--   2. Drop FK constraint from id → auth.users
--   3. Give id a default (uuid_generate_v4)
--   4. Migrate existing rows: auth_id = id (they were the same before)
--   5. Update auth trigger: link by email instead of id
--   6. Update RLS policies to use auth_id / get_my_user_id()
-- =====================================================

-- 1. Add auth_id — the Supabase auth link (set on first Google login)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Give id a self-sufficient default
ALTER TABLE public.users
  ALTER COLUMN id SET DEFAULT uuid_generate_v4();

-- 3. Drop the FK that forces id = auth.users.id
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_id_fkey;

-- 4. Backfill: for every existing user, auth_id = id
--    (Before this migration, id WAS the auth UUID)
UPDATE public.users
  SET auth_id = id
  WHERE auth_id IS NULL;

-- 5. get_my_role(): now looks up by auth_id
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT role FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- 6. get_my_user_id(): returns public.users.id for the current session
CREATE OR REPLACE FUNCTION public.get_my_user_id()
RETURNS UUID LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid() LIMIT 1;
$$;

-- 7. Update books RLS — replace auth.uid() = owner_id with get_my_user_id()
DROP POLICY IF EXISTS "Users can view their own books" ON public.books;
CREATE POLICY "Users can view their own books" ON public.books
  FOR SELECT USING (
    get_my_user_id() = owner_id
    OR get_my_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS "Managers can manage books for their reports" ON public.books;
CREATE POLICY "Managers can manage books for their reports" ON public.books
  FOR ALL USING (
    get_my_role() = 'admin'
    OR (
      get_my_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = owner_id AND u.manager_id = get_my_user_id()
      )
    )
  );

-- 8. Update users self-select policy
DROP POLICY IF EXISTS "Users can view their own profile" ON public.users;
CREATE POLICY "Users can view their own profile" ON public.users
  FOR SELECT USING (
    auth_id = auth.uid()
    OR get_my_role() IN ('admin', 'manager')
  );

-- 9. Update any remaining policies that used id = auth.uid() pattern
-- (These were already fixed in migration 007 via get_my_role, but be safe)
DO $$
BEGIN
  -- Fix monday_sync_log read policy if it uses the old pattern
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'monday_sync_log'
      AND policyname = 'Admins can read sync log'
  ) THEN
    DROP POLICY "Admins can read sync log" ON public.monday_sync_log;
    CREATE POLICY "Admins can read sync log" ON public.monday_sync_log
      FOR SELECT USING (get_my_role() = 'admin');
  END IF;
END;
$$;

-- 10. Update auth trigger to link by email (not id)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Try to link to an existing pre-synced user by email
  UPDATE public.users
    SET auth_id    = NEW.id,
        status     = 'active',
        updated_at = NOW()
  WHERE email = NEW.email
    AND auth_id IS NULL;

  -- If no pre-existing row found, create a default employee row
  IF NOT FOUND THEN
    INSERT INTO public.users (email, full_name, role, status, auth_id)
    VALUES (
      NEW.email,
      COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'name',
        split_part(NEW.email, '@', 1)
      ),
      COALESCE(
        (NEW.raw_user_meta_data->>'role')::user_role,
        'employee'
      ),
      'active',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create the trigger (drop first for idempotency)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

NOTIFY pgrst, 'reload schema';
