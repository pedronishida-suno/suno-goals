-- =====================================================
-- MIGRATION 011 — Auth trigger + Google OAuth provisioning
--
-- Creates a trigger on auth.users that auto-provisions a
-- public.users row whenever a new auth user is created.
-- This handles both:
--   (a) Admin pre-registration via auth.admin.createUser()
--   (b) First-time Google OAuth login for unregistered users
-- =====================================================

-- Auto-provision public.users on new auth.users INSERT
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (
    id,
    email,
    full_name,
    role,
    status,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
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
    -- 'pending' when created by admin API, 'active' when via OAuth login
    CASE
      WHEN NEW.invited_at IS NOT NULL THEN 'pending'
      ELSE 'active'
    END,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;  -- admin may have already inserted; skip

  RETURN NEW;
END;
$$;

-- Drop trigger if it exists (for idempotent re-runs)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
