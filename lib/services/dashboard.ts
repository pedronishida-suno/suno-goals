/**
 * Server-side data fetching for the employee dashboard (/).
 * Transforms BackofficeBook + indicator_data into the BookData / TeamBook types
 * expected by the dashboard components.
 */
import { getBooksByOwner, getBooks } from './books';
import { getMultipleIndicatorsData } from './indicatorData';
import type { BookData, IndicatorType, TeamBook } from '@/types/indicator';
import type { BookIndicatorWithGoals } from '@/types/backoffice';

const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const;

type MonthKey = (typeof MONTH_KEYS)[number];

function formatToUnit(format: string): IndicatorType['unit'] {
  const map: Record<string, IndicatorType['unit']> = {
    percentage: '%',
    currency: 'R$',
    number: '#',
    hours: 'H$',
    boolean: '#',
  };
  return map[format] ?? '#';
}

function buildIndicatorType(
  bi: BookIndicatorWithGoals,
  dataByIndicator: Record<string, { month: number; meta: number; real: number; percentage: number }[]>
): IndicatorType {
  const data = dataByIndicator[bi.indicator_id] ?? [];
  const dataByMonth: Record<number, { meta: number; real: number; percentage: number }> = {};
  for (const d of data) {
    dataByMonth[d.month] = { meta: d.meta, real: d.real, percentage: d.percentage };
  }

  const months = {} as IndicatorType['months'];
  let totalMeta = 0;
  let totalReal = 0;

  MONTH_KEYS.forEach((key: MonthKey, idx: number) => {
    const monthNum = idx + 1;
    const d = dataByMonth[monthNum];
    // Goals from book_indicator_config override indicator_data meta
    const goalMeta = bi.goals[key];
    const meta = goalMeta !== undefined ? goalMeta : (d?.meta ?? 0);
    const real = d?.real ?? 0;
    const percentage = meta === 0 ? 0 : Math.round((real / meta) * 100);
    months[key] = { meta, real, percentage };
    totalMeta += meta;
    totalReal += real;
  });

  const accPercentage = totalMeta === 0 ? 0 : Math.round((totalReal / totalMeta) * 100);

  return {
    id: bi.indicator_id,
    name: bi.indicator_name,
    unit: formatToUnit(bi.indicator_format),
    direction: bi.indicator_direction,
    editable: true, // read-only enforcement happens at API level for Category 1
    accumulated: { meta: totalMeta, real: totalReal, percentage: accPercentage },
    months,
  };
}

export async function getDashboardData(
  userId: string,
  year: number
): Promise<{ myBook: BookData | null; teamBooks: TeamBook[] }> {
  // Fetch user's own books and all readable books in parallel
  const [myBooks, allBooks] = await Promise.all([
    getBooksByOwner(userId, year),
    getBooks({ year }),
  ]);

  const myBook = myBooks[0] ?? null;
  const teamBooksRaw = allBooks.filter((b) => b.owner.id !== userId);

  // Collect all indicator IDs we need monthly data for
  const allIndicatorIds = [
    ...(myBook?.indicators ?? []).map((i) => i.indicator_id),
    ...teamBooksRaw.flatMap((b) => b.indicators.map((i) => i.indicator_id)),
  ];
  const uniqueIds = [...new Set(allIndicatorIds)];

  const dataByIndicator =
    uniqueIds.length > 0 ? await getMultipleIndicatorsData(uniqueIds, year) : {};

  const myBookData: BookData | null = myBook
    ? { indicators: myBook.indicators.map((bi) => buildIndicatorType(bi, dataByIndicator)) }
    : null;

  const teamBooks: TeamBook[] = teamBooksRaw.map((book) => ({
    id: book.id,
    owner: {
      id: book.owner.id,
      name: book.owner.name,
      type: book.owner.type,
      role: book.owner.role,
    },
    lastUpdate: book.updated_at,
    data: {
      indicators: book.indicators.map((bi) => buildIndicatorType(bi, dataByIndicator)),
    },
  }));

  return { myBook: myBookData, teamBooks };
}
