// =====================================================
// INDICADORES - TIPOS E ENUMS
// =====================================================

export type IndicatorStatus = 'validated' | 'in_construction' | 'under_review';

export type IndicatorFormat = 'percentage' | 'number' | 'currency' | 'boolean' | 'hours';

export type IndicatorAggregationType = 'none' | 'average' | 'sum' | 'count';

export type CalculationType = 'soma' | 'media' | 'media_ponderada' | 'valor_mais_recente';

export type IndicatorTagCategory = 'type' | 'business_unit' | 'support_area';

export type IndicatorTag = {
  id: string;
  name: string;
  category: IndicatorTagCategory;
  color: string;
};

export type IndicatorGoal = {
  id: string;
  indicator_id: string;
  user_id?: string;
  team_id?: string;
  year: number;
  goals: {
    jan: number;
    feb: number;
    mar: number;
    apr: number;
    may: number;
    jun: number;
    jul: number;
    aug: number;
    sep: number;
    oct: number;
    nov: number;
    dec: number;
  };
  created_at: Date;
  updated_at: Date;
};

export type IndicatorInBook = {
  book_id: string;
  book_name: string;
  owner_name: string;
  is_manager: boolean; // Se o usuário é gestor (pode editar) ou só visualiza
  achievement_rate: number;
};

export type IndicatorChangeLog = {
  id: string;
  indicator_id: string;
  user_id: string;
  user_name: string;
  action: 'created' | 'updated' | 'deleted' | 'status_changed';
  field_changed?: string;
  old_value?: string;
  new_value?: string;
  created_at: Date;
};

export type BackofficeIndicator = {
  id: string;
  name: string;
  description: string;
  notes?: string;
  format: IndicatorFormat;
  direction: 'up' | 'down';
  status: IndicatorStatus;
  aggregation_type: IndicatorAggregationType;
  calculation_type?: CalculationType;
  aggregated_indicators?: string[]; // IDs dos indicadores agregados
  tags: IndicatorTag[];
  created_by: string;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
  
  // Monday.com people
  responsible_people?: { id: number; name: string }[];

  // Dados calculados
  total_books?: number;
  average_achievement?: number;
  books?: IndicatorInBook[];
  change_log?: IndicatorChangeLog[];
};

// =====================================================
// BOOKS - TIPOS
// =====================================================

export type BookOwnerType = 'person' | 'team';

export type BookOwner = {
  id: string;
  name: string;
  type: BookOwnerType;
  email?: string;
  role?: string;
  team_members_count?: number;
};

export type MonthlyGoals = {
  jan?: number;
  feb?: number;
  mar?: number;
  apr?: number;
  may?: number;
  jun?: number;
  jul?: number;
  aug?: number;
  sep?: number;
  oct?: number;
  nov?: number;
  dec?: number;
};

export type BookIndicatorWithGoals = {
  id: string;
  indicator_id: string;
  indicator_name: string;
  indicator_format: IndicatorFormat;
  indicator_direction: 'up' | 'down';
  indicator_calculation_type?: CalculationType;
  indicator_tags: IndicatorTag[];
  display_order: number;
  goals: MonthlyGoals;
  has_missing_goals: boolean; // Se tem algum mês sem meta
  missing_goals_count: number;
  current_performance?: number; // % de atingimento acumulado
  is_achieving?: boolean; // Se está batendo meta
};

export type BookQuarterHistory = {
  quarter: number; // 1, 2, 3, 4
  year: number;
  indicators: string[]; // IDs dos indicadores
  changes?: {
    added?: string[];
    removed?: string[];
  };
  changed_by?: string;
  changed_at: Date;
};

export type BackofficeBook = {
  id: string;
  name: string;
  year: number;
  owner: BookOwner;
  description?: string;
  indicators: BookIndicatorWithGoals[];
  is_active: boolean;
  
  // Métricas calculadas
  total_indicators: number;
  indicators_with_missing_goals: number;
  overall_performance?: number; // % médio de atingimento
  indicators_achieving?: number; // Quantos estão batendo meta
  performance_level?: 'excellent' | 'good' | 'regular' | 'critical'; // >95, 80-95, 70-80, <70
  
  // Quarters
  active_quarters: number[]; // [1, 2, 3, 4]
  current_quarter?: number;
  
  // Histórico
  history?: BookQuarterHistory[];
  
  // Metadata
  created_by: string;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
};

export type BookFilters = {
  search?: string;
  year?: number;
  owner_type?: BookOwnerType[];
  is_active?: boolean;
  has_missing_goals?: boolean;
  performance_level?: ('excellent' | 'good' | 'regular' | 'critical')[];
  business_unit?: string[]; // Tags de unidade de negócio
};

// =====================================================
// FILTROS
// =====================================================

export type IndicatorFilters = {
  search?: string;
  status?: IndicatorStatus[];
  format?: IndicatorFormat[];
  tags?: string[];
  created_by?: string;
  has_books?: boolean;
};

