export type IndicatorDirection = 'up' | 'down';

export type MonthData = {
  meta: number;
  real: number;
  percentage: number;
};

export type IndicatorTag = {
  id: string;
  name: string;
  category: 'type' | 'business_unit' | 'support_area';
  color: string;
};

export type CalculationType = 'soma' | 'media' | 'media_ponderada' | 'valor_mais_recente';

export type IndicatorType = {
  id: string;
  name: string;
  unit: '%' | '#' | 'R$' | 'H$';
  direction: IndicatorDirection;
  calculationType?: CalculationType;
  editable: boolean; // Se o usuário pode editar o "realizado"
  accumulated: MonthData;
  tags?: IndicatorTag[];
  icpLabel?: string | null;
  months: {
    jan: MonthData;
    feb: MonthData;
    mar: MonthData;
    apr: MonthData;
    may: MonthData;
    jun: MonthData;
    jul: MonthData;
    aug: MonthData;
    sep: MonthData;
    oct: MonthData;
    nov: MonthData;
    dec: MonthData;
  };
};

export type BookData = {
  indicators: IndicatorType[];
};

export type BookOwnerType = 'person' | 'team';

export type BookOwner = {
  id: string;
  name: string;
  type: BookOwnerType;
  role?: string; // Ex: "Head de Dados e CRM", "Gerente", etc.
  teamName?: string; // Ex: "Time de Dados", "Squad CRM"
};

export type TeamBook = {
  id: string;
  owner: BookOwner;
  data: BookData;
  lastUpdate?: Date; // Data da última atualização
};

export type NotificationType = 'missing_book' | 'outdated_book';

export type Notification = {
  id: string;
  type: NotificationType;
  message: string;
  ownerName: string;
  severity: 'warning' | 'error';
};

export type MacroIndicators = {
  totalIndicators: number;
  achieving: number; // Batendo meta
  notAchieving: number; // Não batendo meta
  achievementRate: number; // % de atingimento
};

