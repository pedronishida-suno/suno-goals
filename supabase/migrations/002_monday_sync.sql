-- =====================================================
-- MIGRATION 002 — Monday Sync Readiness
-- Run AFTER schema.sql + indicators_module.sql + 001_phase1.sql
-- =====================================================

-- 1. Allow service-synced rows to have no created_by
ALTER TABLE public.backoffice_indicators
  ALTER COLUMN created_by DROP NOT NULL;

-- 2. Description is rarely filled from Monday — make it nullable
ALTER TABLE public.backoffice_indicators
  ALTER COLUMN description DROP NOT NULL,
  ALTER COLUMN description SET DEFAULT '';

-- 3. monday_item_id for stable upsert matching
ALTER TABLE public.backoffice_indicators
  ADD COLUMN IF NOT EXISTS monday_item_id BIGINT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_backoffice_indicators_monday
  ON public.backoffice_indicators(monday_item_id);

-- 4. Fix indicator_data FK: was pointing to legacy indicators table
ALTER TABLE public.indicator_data
  DROP CONSTRAINT IF EXISTS indicator_data_indicator_id_fkey;

ALTER TABLE public.indicator_data
  ADD CONSTRAINT indicator_data_indicator_id_fkey
  FOREIGN KEY (indicator_id) REFERENCES public.backoffice_indicators(id) ON DELETE CASCADE;

-- 5. Refresh indicators_with_stats to include all columns from 001
CREATE OR REPLACE VIEW public.indicators_with_stats AS
SELECT
  i.*,
  u.full_name AS created_by_name,
  (
    SELECT COUNT(DISTINCT bic.book_id)
    FROM public.book_indicator_config bic
    WHERE bic.indicator_id = i.id
  ) AS total_books,
  (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'id', t.id,
          'name', t.name,
          'color', t.color,
          'category', t.category
        )
      ) FILTER (WHERE t.id IS NOT NULL),
      '[]'::json
    )
    FROM public.indicator_tag_relations itr
    LEFT JOIN public.indicator_tags t ON itr.tag_id = t.id
    WHERE itr.indicator_id = i.id
  ) AS tags,
  (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'id', cl.id,
          'indicator_id', cl.indicator_id,
          'user_id', cl.user_id,
          'action', cl.action,
          'field_changed', cl.field_changed,
          'old_value', cl.old_value,
          'new_value', cl.new_value,
          'created_at', cl.created_at
        ) ORDER BY cl.created_at DESC
      ) FILTER (WHERE cl.id IS NOT NULL),
      '[]'::json
    )
    FROM public.indicator_change_log cl
    WHERE cl.indicator_id = i.id
  ) AS change_log
FROM public.backoffice_indicators i
LEFT JOIN public.users u ON i.created_by = u.id
WHERE i.is_active = true;
