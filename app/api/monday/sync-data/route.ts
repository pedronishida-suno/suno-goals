import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

const MONDAY_API_URL = 'https://api.monday.com/v2';
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN ?? '';
const BOARD_ID = 3896178865;

const CATALOG_COLS = ['text2', 'text7', 'text23', 'color91', 'color0', 'color2', 'color8', 'multiple_person'];

/**
 * POST /api/monday/sync-data
 * Full upsert of indicator catalog from Monday.com → backoffice_indicators.
 * Matches by monday_item_id (stable). Creates new rows if not yet in Supabase.
 * Protected: admin session or service-role bearer token.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const isServiceCall = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (!isServiceCall) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .single();

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }
  }

  // 1. Fetch catalog from Monday
  let mondayItems: MondayCatalogItem[];
  try {
    mondayItems = await fetchCatalogItems();
  } catch (err) {
    return NextResponse.json(
      { error: `Monday.com fetch failed: ${String(err)}` },
      { status: 502 }
    );
  }

  // Skip placeholder/empty items
  const validItems = mondayItems.filter(i => i.friendlyName.trim().length > 0);

  // 2. Upsert by monday_item_id — service client bypasses RLS
  const supabase = createServiceClient();
  const { error, count } = await supabase
    .from('backoffice_indicators')
    .upsert(
      validItems.map(item => ({
        monday_item_id: Number(item.id),
        name: item.friendlyName,
        description: item.description || null,
        direction: item.direction ?? 'up',
        format: item.format ?? 'number',
        aggregation_type: item.aggregationType ?? 'none',
        status: item.isActive === false ? 'in_construction' : 'validated',
        data_source: 'monday',
        is_active: true,
        responsible_people: item.responsiblePeople,
      })),
      { onConflict: 'monday_item_id', count: 'exact' }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    monday_items_fetched: mondayItems.length,
    valid_items: validItems.length,
    upserted: count ?? validItems.length,
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
  responsiblePeople: { id: number; name: string }[];
}

async function fetchCatalogItems(): Promise<MondayCatalogItem[]> {
  const colValuesQuery = `column_values(ids: ${JSON.stringify(CATALOG_COLS)}) { id text value }`;
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

    if (!res.ok) throw new Error(`Monday.com API error: ${res.status}`);

    const json = await res.json() as {
      data: { boards: Array<{ items_page: { cursor: string | null; items: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string | null; value: string | null }> }> } }> };
      errors?: { message: string }[];
    };

    if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join(', '));

    const page = json.data.boards[0]?.items_page;
    if (!page) break;

    for (const item of page.items) {
      const col: Record<string, string | null> = {};
      for (const cv of item.column_values) { col[cv.id] = cv.text; }

      // Parse people column (value is JSON, text is comma-separated names)
      const peopleText = col['multiple_person'] ?? '';
      const peopleValue = item.column_values.find(cv => cv.id === 'multiple_person')?.value;
      let responsiblePeople: { id: number; name: string }[] = [];
      if (peopleValue) {
        try {
          const parsed = JSON.parse(peopleValue) as { personsAndTeams?: { id: number; kind: string }[] };
          const names = peopleText.split(',').map(n => n.trim()).filter(Boolean);
          responsiblePeople = (parsed.personsAndTeams ?? [])
            .filter(p => p.kind === 'person')
            .map((p, i) => ({ id: p.id, name: names[i] ?? `Person ${p.id}` }));
        } catch { /* ignore parse errors */ }
      }

      items.push({
        id: item.id,
        name: item.name,
        friendlyName: col['text2'] ?? '',
        description: col['text23'] ?? null,
        isActive: mapStatus(col['color91']),
        direction: mapDirection(col['color0']),
        format: mapFormat(col['color2']),
        aggregationType: mapAggregation(col['color8']),
        responsiblePeople,
      });
    }

    cursor = page.cursor ?? null;
    if (!cursor) break;
  }

  return items;
}

// =====================================================
// Mappers (using .text field — already resolved label)
// =====================================================

function mapStatus(text: string | null): boolean | null {
  if (!text) return null;
  const l = text.toLowerCase();
  if (l.includes('ativo') || l === 'active') return true;
  if (l.includes('inativo') || l === 'inactive') return false;
  return null;
}

function mapDirection(text: string | null): 'up' | 'down' | null {
  if (!text) return null;
  const l = text.toLowerCase();
  if (l.includes('cima') || l === 'up') return 'up';
  if (l.includes('baixo') || l === 'down') return 'down';
  return null;
}

function mapFormat(text: string | null): 'percentage' | 'number' | 'currency' | null {
  if (!text) return null;
  if (text === '%') return 'percentage';
  if (text.startsWith('R$')) return 'currency';
  if (text === '#') return 'number';
  if (text === 'h') return 'hours' as 'number'; // hours maps to number format
  return null;
}

function mapAggregation(text: string | null): 'sum' | 'average' | 'none' | null {
  if (!text) return null;
  const l = text.toLowerCase();
  if (l.includes('soma') || l === 'sum') return 'sum';
  if (l.includes('média') || l.includes('media') || l === 'average') return 'average';
  return null;
}
