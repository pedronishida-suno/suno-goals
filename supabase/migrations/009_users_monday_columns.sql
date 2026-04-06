-- =====================================================
-- MIGRATION 009 — Add Monday-sourced columns to users
--
-- Adds grade, diretoria, and negocio fields that come
-- from the Colaboradores board (status6, status5, status99).
-- Also ensures manager_email lookup works by adding an
-- index on users.email for fast join during sync.
-- =====================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS grade     TEXT,
  ADD COLUMN IF NOT EXISTS diretoria TEXT,
  ADD COLUMN IF NOT EXISTS negocio   TEXT;

-- Fast email lookups used by sync-colaboradores manager resolution
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(lower(email));

NOTIFY pgrst, 'reload schema';
