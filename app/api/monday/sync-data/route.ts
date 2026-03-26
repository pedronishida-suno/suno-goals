import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN ?? '';
const BOARD_ID = 3896178865;

// Column IDs for indicator metadata on the Monday board
const CATALOG_COLS = ['text2', 'text7', 'text23', 'color91', 'color0', 'color2', 'color8'];

/**
 * POST /api/monday/sync-data
 * Syncs indicator catalog metadata from Monday.com → backoffice_indicators.
 * Updates: is_active, direction, format, aggregation_type, description for matched indicators.
 * Matching is done by normalized name (text2 friendly name vs backoffice_indicators.name).
 *
 * Protected: admin only or service-role bearer token.
 */
export async function POST(request: NextRequest) {
  // Auth: admin session or service-role bearer
  const authHeader = request.headers.get('authorization');
  const isServiceCall = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (!isServiceCall) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }
  }

  // 1. Fetch catalog data from Monday
  let mondayItems: MondayCatalogItem[];
  try {
    mondayItems = await fetchCatalogItems();
  } catch (err) {
    return NextResponse.json(
      { error: `Monday.com fetch failed: ${String(err)}` },
      { status: 502 }
    );
  }

  // 2. Load existing indicators from Supabase for matching
  const supabase = await createClient();
  const { data: existing, error: fetchError } = await supabase
    .from('backoffice_indicators')
    .select('id, name');

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const nameToId = new Map<string, string>();
  for (const ind of existing ?? []) {
    nameToId.set(normalize(ind.name), ind.id);
  }

  // 3. Match Monday items to Supabase indicators and build update payloads
  const updates: { id: string; payload: Record<string, unknown> }[] = [];
  const unmatched: string[] = [];

  for (const item of mondayItems) {
    const key = normalize(item.friendlyName || item.name);
    const indicatorId = nameToId.get(key) ?? nameToId.get(normalize(item.name));

    if (!indicatorId) {
      unmatched.push(item.friendlyName || item.name);
      continue;
    }

    const payload: Record<string, unknown> = {};

    if (item.isActive !== null) payload.is_active = item.isActive;
    if (item.direction !== null) payload.direction = item.direction;
    if (item.format !== null) payload.format = item.format;
    if (item.aggregationType !== null) payload.aggregation_type = item.aggregationType;
    if (item.description) payload.description = item.description;

    if (Object.keys(payload).length > 0) {
      updates.push({ id: indicatorId, payload });
    }
  }

  // 4. Apply updates in chunks
  let updated = 0;
  const errors: string[] = [];
  for (const { id, payload } of updates) {
    const { error } = await supabase
      .from('backoffice_indicators')
      .update(payload)
      .eq('id', id);

    if (error) {
      errors.push(`${id}: ${error.message}`);
    } else {
      updated++;
    }
  }

  return NextResponse.json({
    success: true,
    monday_items_fetched: mondayItems.length,
    matched: updates.length,
    updated,
    unmatched: unmatched.length,
    unmatched_names: unmatched.slice(0, 20),
    errors: errors.slice(0, 10),
  });
}

// =====================================================
// Monday.com fetcher
// =====================================================

interface MondayCatalogItem {
  id: string;
  name: string;
  friendlyName: string;
  description: string | null;
  isActive: boolean | null;
  direction: 'up' | 'down' | null;
  format: 'percentage' | 'number' | 'currency' | null;
  aggregationType: 'sum' | 'average' | 'none' | null;
}

async function fetchCatalogItems(): Promise<MondayCatalogItem[]> {
  const colValuesQuery = `column_values(ids: ${JSON.stringify(CATALOG_COLS)}) { id value }`;
  const items: MondayCatalogItem[] = [];
  let cursor: string | null = null;

  while (true) {
    const cursorPart = cursor ? `, cursor: "${cursor}"` : '';
    const query = `
      query {
        boards(ids: [${BOARD_ID}]) {
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

    const res = await fetch(MONDAY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: MONDAY_API_TOKEN,
        'API-Version': '2024-01',
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      throw new Error(`Monday.com API error: ${res.status}`);
    }

    const json = await res.json() as {
      data: {
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
      errors?: { message: string }[];
    };

    if (json.errors?.length) {
      throw new Error(json.errors.map(e => e.message).join(', '));
    }

    const page = json.data.boards[0]?.items_page;
    if (!page) break;

    for (const item of page.items) {
      const cols: Record<string, unknown> = {};
      for (const cv of item.column_values) {
        cols[cv.id] = cv.value ? safeJsonParse(cv.value) : null;
      }

      items.push({
        id: item.id,
        name: item.name,
        friendlyName: extractText(cols['text2']),
        description: extractText(cols['text23']),
        isActive: mapStatus(extractLabel(cols['color91'])),
        direction: mapDirection(extractLabel(cols['color0'])),
        format: mapFormat(extractLabel(cols['color2'])),
        aggregationType: mapAggregation(extractLabel(cols['color8'])),
      });
    }

    cursor = page.cursor ?? null;
    if (!cursor) break;
  }

  return items;
}

// =====================================================
// Parsers
// =====================================================

function safeJsonParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'text' in value) return String((value as Record<string, unknown>).text);
  return '';
}

function extractLabel(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'object' && 'label' in value) {
    const label = (value as Record<string, unknown>).label;
    if (label && typeof label === 'object' && 'text' in label) return String((label as Record<string, unknown>).text);
    return String(label);
  }
  if (typeof value === 'string') return value;
  return null;
}

function mapStatus(label: string | null): boolean | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes('ativo') || l === 'active') return true;
  if (l.includes('inativo') || l === 'inactive') return false;
  return null;
}

function mapDirection(label: string | null): 'up' | 'down' | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes('cima') || l === 'up') return 'up';
  if (l.includes('baixo') || l === 'down') return 'down';
  return null;
}

function mapFormat(label: string | null): 'percentage' | 'number' | 'currency' | null {
  if (!label) return null;
  if (label === '%') return 'percentage';
  if (label === 'R$') return 'currency';
  if (label === '#') return 'number';
  return null;
}

function mapAggregation(label: string | null): 'sum' | 'average' | 'none' | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (l.includes('soma') || l === 'sum') return 'sum';
  if (l.includes('média') || l.includes('media') || l === 'average') return 'average';
  return null;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
