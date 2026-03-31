-- =====================================================
-- MIGRATION 003 — Apply missing indicators module schema
-- Safe to run: uses IF NOT EXISTS / DO $$ blocks
-- =====================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Functions (create if missing)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role::text FROM public.users WHERE id = auth.uid()
$$;

-- Enums (skip if already exist)
DO $$ BEGIN
  CREATE TYPE indicator_direction AS ENUM ('up', 'down');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE indicator_status AS ENUM ('validated', 'in_construction', 'under_review');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE indicator_format AS ENUM ('percentage', 'number', 'currency', 'boolean', 'hours');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE aggregation_type AS ENUM ('none', 'average', 'sum', 'count');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add missing columns to backoffice_indicators
ALTER TABLE public.backoffice_indicators
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS format indicator_format NOT NULL DEFAULT 'number',
  ADD COLUMN IF NOT EXISTS direction indicator_direction NOT NULL DEFAULT 'up',
  ADD COLUMN IF NOT EXISTS status indicator_status NOT NULL DEFAULT 'in_construction',
  ADD COLUMN IF NOT EXISTS aggregation_type aggregation_type NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS aggregated_indicators UUID[],
  ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'manual'
    CHECK (data_source IN ('manual', 'snowflake', 'monday')),
  ADD COLUMN IF NOT EXISTS category INTEGER DEFAULT 3
    CHECK (category BETWEEN 1 AND 4);

-- indicator_tags
CREATE TABLE IF NOT EXISTS public.indicator_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  color TEXT DEFAULT '#999999',
  category TEXT DEFAULT 'type' CHECK (category IN ('type', 'business_unit', 'support_area')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- indicator_tag_relations
CREATE TABLE IF NOT EXISTS public.indicator_tag_relations (
  indicator_id UUID NOT NULL REFERENCES public.backoffice_indicators(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.indicator_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (indicator_id, tag_id)
);

-- indicator_goals
CREATE TABLE IF NOT EXISTS public.indicator_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  indicator_id UUID NOT NULL REFERENCES public.backoffice_indicators(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  team_id UUID,
  year INTEGER NOT NULL,
  jan NUMERIC DEFAULT 0, feb NUMERIC DEFAULT 0, mar NUMERIC DEFAULT 0,
  apr NUMERIC DEFAULT 0, may NUMERIC DEFAULT 0, jun NUMERIC DEFAULT 0,
  jul NUMERIC DEFAULT 0, aug NUMERIC DEFAULT 0, sep NUMERIC DEFAULT 0,
  oct NUMERIC DEFAULT 0, nov NUMERIC DEFAULT 0, dec NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(indicator_id, user_id, year),
  CHECK (user_id IS NOT NULL OR team_id IS NOT NULL)
);

-- book_indicator_config
CREATE TABLE IF NOT EXISTS public.book_indicator_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  indicator_id UUID NOT NULL REFERENCES public.backoffice_indicators(id) ON DELETE CASCADE,
  is_manager BOOLEAN DEFAULT false,
  display_order INTEGER DEFAULT 0,
  custom_jan NUMERIC, custom_feb NUMERIC, custom_mar NUMERIC,
  custom_apr NUMERIC, custom_may NUMERIC, custom_jun NUMERIC,
  custom_jul NUMERIC, custom_aug NUMERIC, custom_sep NUMERIC,
  custom_oct NUMERIC, custom_nov NUMERIC, custom_dec NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, indicator_id)
);

-- indicator_change_log
CREATE TABLE IF NOT EXISTS public.indicator_change_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  indicator_id UUID NOT NULL REFERENCES public.backoffice_indicators(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  action TEXT NOT NULL,
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_backoffice_indicators_status ON public.backoffice_indicators(status);
CREATE INDEX IF NOT EXISTS idx_backoffice_indicators_format ON public.backoffice_indicators(format);
CREATE INDEX IF NOT EXISTS idx_backoffice_indicators_active ON public.backoffice_indicators(is_active);
CREATE INDEX IF NOT EXISTS idx_indicator_goals_indicator ON public.indicator_goals(indicator_id);
CREATE INDEX IF NOT EXISTS idx_indicator_goals_year ON public.indicator_goals(year);
CREATE INDEX IF NOT EXISTS idx_book_indicator_config_book ON public.book_indicator_config(book_id);
CREATE INDEX IF NOT EXISTS idx_indicator_change_log_indicator ON public.indicator_change_log(indicator_id);

-- updated_at triggers
DO $$ BEGIN
  CREATE TRIGGER update_indicator_goals_updated_at
    BEFORE UPDATE ON public.indicator_goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_book_indicator_config_updated_at
    BEFORE UPDATE ON public.book_indicator_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================
-- RLS
-- =====================================================
ALTER TABLE public.indicator_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicator_tag_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backoffice_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicator_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_indicator_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indicator_change_log ENABLE ROW LEVEL SECURITY;

-- Helper macro: create policy only if it doesn't exist
-- indicator_tags
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_tags' AND policyname='Authenticated can read tags') THEN
    CREATE POLICY "Authenticated can read tags" ON public.indicator_tags FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_tags' AND policyname='Admins insert tags') THEN
    CREATE POLICY "Admins insert tags" ON public.indicator_tags FOR INSERT WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_tags' AND policyname='Admins update tags') THEN
    CREATE POLICY "Admins update tags" ON public.indicator_tags FOR UPDATE USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_tags' AND policyname='Admins delete tags') THEN
    CREATE POLICY "Admins delete tags" ON public.indicator_tags FOR DELETE USING (get_my_role() = 'admin');
  END IF;
END $$;

-- indicator_tag_relations
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_tag_relations' AND policyname='Authenticated can read tag relations') THEN
    CREATE POLICY "Authenticated can read tag relations" ON public.indicator_tag_relations FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_tag_relations' AND policyname='Admins insert tag relations') THEN
    CREATE POLICY "Admins insert tag relations" ON public.indicator_tag_relations FOR INSERT WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_tag_relations' AND policyname='Admins delete tag relations') THEN
    CREATE POLICY "Admins delete tag relations" ON public.indicator_tag_relations FOR DELETE USING (get_my_role() = 'admin');
  END IF;
END $$;

-- backoffice_indicators
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='backoffice_indicators' AND policyname='Authenticated can read indicators') THEN
    CREATE POLICY "Authenticated can read indicators" ON public.backoffice_indicators FOR SELECT USING (auth.uid() IS NOT NULL);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='backoffice_indicators' AND policyname='Admins insert indicators') THEN
    CREATE POLICY "Admins insert indicators" ON public.backoffice_indicators FOR INSERT WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='backoffice_indicators' AND policyname='Admins update indicators') THEN
    CREATE POLICY "Admins update indicators" ON public.backoffice_indicators FOR UPDATE USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='backoffice_indicators' AND policyname='Admins delete indicators') THEN
    CREATE POLICY "Admins delete indicators" ON public.backoffice_indicators FOR DELETE USING (get_my_role() = 'admin');
  END IF;
END $$;

-- indicator_goals
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_goals' AND policyname='Admins manage goals select') THEN
    CREATE POLICY "Admins manage goals select" ON public.indicator_goals FOR SELECT USING (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_goals' AND policyname='Admins manage goals insert') THEN
    CREATE POLICY "Admins manage goals insert" ON public.indicator_goals FOR INSERT WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_goals' AND policyname='Admins manage goals update') THEN
    CREATE POLICY "Admins manage goals update" ON public.indicator_goals FOR UPDATE USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_goals' AND policyname='Admins manage goals delete') THEN
    CREATE POLICY "Admins manage goals delete" ON public.indicator_goals FOR DELETE USING (get_my_role() = 'admin');
  END IF;
END $$;

-- book_indicator_config
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='book_indicator_config' AND policyname='Admins manage book config select') THEN
    CREATE POLICY "Admins manage book config select" ON public.book_indicator_config FOR SELECT USING (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='book_indicator_config' AND policyname='Admins manage book config insert') THEN
    CREATE POLICY "Admins manage book config insert" ON public.book_indicator_config FOR INSERT WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='book_indicator_config' AND policyname='Admins manage book config update') THEN
    CREATE POLICY "Admins manage book config update" ON public.book_indicator_config FOR UPDATE USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='book_indicator_config' AND policyname='Admins manage book config delete') THEN
    CREATE POLICY "Admins manage book config delete" ON public.book_indicator_config FOR DELETE USING (get_my_role() = 'admin');
  END IF;
END $$;

-- indicator_change_log
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='indicator_change_log' AND policyname='Admins read change log') THEN
    CREATE POLICY "Admins read change log" ON public.indicator_change_log FOR SELECT USING (get_my_role() = 'admin');
  END IF;
END $$;

-- Seed default tags
INSERT INTO public.indicator_tags (name, color, category) VALUES
  ('Financeiro', '#d42126', 'type'),
  ('Operacional', '#666666', 'type'),
  ('Estratégico', '#4b4b4b', 'type'),
  ('Qualidade', '#999999', 'type'),
  ('Produtividade', '#666666', 'type'),
  ('Tecnologia', '#4b4b4b', 'business_unit'),
  ('FP&A', '#d42126', 'business_unit'),
  ('Dados/BI', '#666666', 'business_unit'),
  ('Advisory', '#999999', 'business_unit'),
  ('Status Invest', '#4b4b4b', 'business_unit'),
  ('RH', '#666666', 'business_unit'),
  ('G-LOTS', '#d42126', 'support_area'),
  ('PDCA', '#4b4b4b', 'support_area')
ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
