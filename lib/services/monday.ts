/**
 * Monday.com GraphQL client and data fetching utilities.
 * Source: "Indicadores e Metas (Atualize os resultados)" board (ID: 3896178865)
 */

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN ?? '';

// Board IDs
export const MONDAY_BOARDS = {
  INDICADORES_E_METAS: 3896178865,
  RESULTADO_BOOKS_2025: 18397693246,
  COLABORADORES: 3958295293,
} as const;

// Column ID mapping for "Indicadores e Metas" board — year 2026
export const MONDAY_COL_2026 = {
  meta: [
    'numeric',   // Jan
    'numeric3',  // Feb
    'numeric2',  // Mar
    'numeric32', // Apr
    'numeric39', // May
    'numeric0',  // Jun
    'numeric1',  // Jul
    'numeric04', // Aug
    'numeric17', // Sep
    'numeric7',  // Oct
    'numeric05', // Nov
    'numeric6',  // Dec
  ],
  real: [
    'numeric742',  // Jan
    'numeric30',   // Feb
    'numeric00',   // Mar
    'numeric25',   // Apr
    'numeric4',    // May
    'numeric307',  // Jun
    'numeric207',  // Jul
    'numeric311',  // Aug
    'numeric759',  // Sep
    'numeric26',   // Oct
    'numeric58',   // Nov
    'numeric57',   // Dec
  ],
} as const;

export interface MondayIndicatorItem {
  id: string;
  name: string;               // item name
  indicatorName: string;      // text2 column
  indicatorKey: string;       // text7 column (Chave Indicador Backup)
  monthly: Array<{
    month: number;            // 1–12
    meta: number | null;
    real: number | null;
  }>;
}

async function mondayGraphQL<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: MONDAY_API_TOKEN,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Monday.com API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json() as { data: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Monday.com GraphQL errors: ${json.errors.map(e => e.message).join(', ')}`);
  }
  return json.data;
}

/**
 * Fetch all items from the Indicadores e Metas board with 2026 meta/real values.
 * Uses cursor-based pagination to get all 3000+ items.
 */
export async function fetchMondayIndicators(year = 2026): Promise<MondayIndicatorItem[]> {
  const allColumnIds = year === 2026
    ? [...MONDAY_COL_2026.meta, ...MONDAY_COL_2026.real, 'text2', 'text7', 'name']
    : [...MONDAY_COL_2026.meta, ...MONDAY_COL_2026.real, 'text2', 'text7', 'name'];

  // Build the column_values fragment with specific IDs to reduce payload size
  const colValuesQuery = `column_values(ids: ${JSON.stringify(allColumnIds)}) { id value }`;

  const items: MondayIndicatorItem[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const cursorPart: string = cursor ? `, cursor: "${cursor}"` : '';
    const query: string = `
      query {
        boards(ids: [${MONDAY_BOARDS.INDICADORES_E_METAS}]) {
          items_page(limit: 200${cursorPart}) {
            cursor
            items {
              id
              name
              ${colValuesQuery}
            }
          }
        }
      }
    `;

    type PageData = {
      boards: Array<{
        items_page: {
          cursor: string | null;
          items: Array<{
            id: string;
            name: string;
            column_values: Array<{ id: string; value: string | null }>;
          }>;
        };
      }>;
    };
    const data = await mondayGraphQL<PageData>(query);

    const page = data.boards[0]?.items_page;
    if (!page) break;

    for (const item of page.items) {
      const colMap: Record<string, string | null> = {};
      for (const cv of item.column_values) {
        // Monday returns numbers as JSON strings like "123.45" or null
        colMap[cv.id] = cv.value ? JSON.parse(cv.value) as string : null;
      }

      const monthly = MONDAY_COL_2026.meta.map((metaId, idx) => {
        const realId = MONDAY_COL_2026.real[idx];
        return {
          month: idx + 1,
          meta: colMap[metaId] != null ? Number(colMap[metaId]) : null,
          real: colMap[realId] != null ? Number(colMap[realId]) : null,
        };
      });

      // Skip items with no data at all
      const hasAnyData = monthly.some(m => m.meta != null || m.real != null);
      if (!hasAnyData) continue;

      items.push({
        id: item.id,
        name: item.name,
        indicatorName: String(colMap['text2'] ?? item.name),
        indicatorKey: String(colMap['text7'] ?? ''),
        monthly,
      });
    }

    cursor = page.cursor ?? null;
    hasMore = !!cursor;
  }

  return items;
}

/**
 * Lightweight fetch — just names and keys, no monthly data.
 * Used by the AI context builder for the indicator catalog.
 */
export async function fetchMondayIndicatorCatalog(): Promise<Array<{
  id: string;
  name: string;
  key: string;
}>> {
  const query = `
    query {
      boards(ids: [${MONDAY_BOARDS.INDICADORES_E_METAS}]) {
        items_page(limit: 200) {
          items {
            id
            name
            column_values(ids: ["text7", "text2"]) { id value }
          }
        }
      }
    }
  `;

  const data = await mondayGraphQL<{
    boards: Array<{
      items_page: {
        items: Array<{
          id: string;
          name: string;
          column_values: Array<{ id: string; value: string | null }>;
        }>;
      };
    }>;
  }>(query);

  return (data.boards[0]?.items_page.items ?? []).map(item => {
    const keyCol = item.column_values.find(c => c.id === 'text7');
    const nameCol = item.column_values.find(c => c.id === 'text2');
    return {
      id: item.id,
      name: nameCol?.value ? String(JSON.parse(nameCol.value)) : item.name,
      key: keyCol?.value ? String(JSON.parse(keyCol.value)) : '',
    };
  });
}
