-- =====================================================
-- MIGRATION 010 — Add 'books' to monday_sync_log.sync_type
--
-- Allows the new sync-books Edge Function to log runs
-- in the monday_sync_log table.
-- =====================================================

-- Drop and re-add CHECK constraint to include 'books'
ALTER TABLE public.monday_sync_log
  DROP CONSTRAINT IF EXISTS monday_sync_log_sync_type_check;

ALTER TABLE public.monday_sync_log
  ADD CONSTRAINT monday_sync_log_sync_type_check
  CHECK (sync_type IN (
    'catalog', 'indicator_data', 'colaboradores',
    'resultado_books', 'books', 'webhook'
  ));
