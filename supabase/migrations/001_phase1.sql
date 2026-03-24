-- =====================================================
-- MIGRATION 001 — PHASE 1 ADDITIONS
-- Suno Terminal de Controle de Indicadores
-- =====================================================
-- Run this AFTER schema.sql and indicators_module.sql
-- All changes are additive (no breaking changes)

-- =====================================================
-- 1. TEAMS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  manager_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  department TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_in_team TEXT, -- e.g. "Tech Lead", "Developer"
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Add team_id to users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_teams_manager ON public.teams(manager_id);
CREATE INDEX IF NOT EXISTS idx_teams_department ON public.teams(department);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON public.team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_users_team ON public.users(team_id);

-- Trigger updated_at
CREATE TRIGGER update_teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone can view active teams" ON public.teams
  FOR SELECT USING (is_active = true AND auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage teams" ON public.teams
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Everyone can view team members" ON public.team_members
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage team members" ON public.team_members
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- =====================================================
-- 2. INDICATOR TAG CATEGORY
-- =====================================================

-- Add category column to indicator_tags (type / business_unit / support_area)
ALTER TABLE public.indicator_tags
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'type'
  CHECK (category IN ('type', 'business_unit', 'support_area'));

-- =====================================================
-- 3. SNOWFLAKE / DATA SOURCE CLASSIFICATION ON BACKOFFICE_INDICATORS
-- Category 1: fully automated via Snowflake (read-only)
-- Category 2: automated but manager can override
-- Category 3: manual input by employee (exception)
-- Category 4: manual input by manager only
-- =====================================================

ALTER TABLE public.backoffice_indicators
  ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'manual'
  CHECK (data_source IN ('manual', 'snowflake'));

ALTER TABLE public.backoffice_indicators
  ADD COLUMN IF NOT EXISTS category INTEGER DEFAULT 3
  CHECK (category BETWEEN 1 AND 4);

-- For category 1 indicators, is_editable should be set to false by convention.
-- The application enforces this; the DB column data_source='snowflake' is the source of truth.

-- =====================================================
-- 4. YEAR COLUMN ON BOOKS
-- =====================================================

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS year INTEGER DEFAULT EXTRACT(YEAR FROM NOW())::INTEGER;

-- =====================================================
-- 5. KNOWLEDGE DOCUMENTS (Phase 4 RAG preparation)
-- =====================================================

-- Enable pgvector for semantic search (run separately if not already enabled)
-- CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  -- embedding VECTOR(1536),  -- uncomment after enabling pgvector
  source TEXT, -- e.g. 'falconi_book', 'pdca_playbook', 'action_plan_history'
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage knowledge documents" ON public.knowledge_documents
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Authenticated users can read knowledge documents" ON public.knowledge_documents
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- =====================================================
-- 6. MANAGER VIEW — RLS UPDATE
-- Allow managers to view all books in their department
-- =====================================================

-- Drop old restrictive policy and recreate with manager support
DROP POLICY IF EXISTS "Users can view their own books" ON public.books;

CREATE POLICY "Users can view their own books" ON public.books
  FOR SELECT USING (
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Managers can also insert/update books for their reports
CREATE POLICY "Managers can manage books for their reports" ON public.books
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'manager'
    )
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = owner_id AND u.manager_id = auth.uid()
    )
  );

-- =====================================================
-- 7. USER STATUS COLUMN
-- The TS type has UserStatus: 'pending' | 'active' | 'inactive'
-- but schema only has is_active BOOLEAN
-- =====================================================

CREATE TYPE IF NOT EXISTS user_status AS ENUM ('pending', 'active', 'inactive');

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status user_status DEFAULT 'pending';

-- Migrate existing data: active users get 'active', inactive get 'inactive'
UPDATE public.users SET status = CASE
  WHEN is_active = true THEN 'active'::user_status
  ELSE 'inactive'::user_status
END
WHERE status IS NULL OR status = 'pending';

-- =====================================================
-- 8. UPDATED TAGS SEED DATA (with categories)
-- =====================================================

-- Update existing tags to have proper categories
UPDATE public.indicator_tags SET category = 'type' WHERE name IN ('Financeiro', 'Operacional', 'Estratégico', 'Qualidade', 'Produtividade');

-- Add business_unit tags (Suno sectors from docx)
INSERT INTO public.indicator_tags (name, color, category) VALUES
  ('Tecnologia', '#4b4b4b', 'business_unit'),
  ('FP&A', '#d42126', 'business_unit'),
  ('Dados/BI', '#666666', 'business_unit'),
  ('Advisory', '#999999', 'business_unit'),
  ('Status Invest', '#4b4b4b', 'business_unit'),
  ('RH', '#666666', 'business_unit')
ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category;

-- Add support_area tags
INSERT INTO public.indicator_tags (name, color, category) VALUES
  ('G-LOTS', '#d42126', 'support_area'),
  ('PDCA', '#4b4b4b', 'support_area')
ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category;
