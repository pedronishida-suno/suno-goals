import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export interface MondayPerson {
  id: number;
  name: string;
  indicator_count: number;
}

/**
 * GET /api/monday/people
 * Returns distinct people from responsible_people jsonb, sorted by name.
 * Requires authenticated session.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('backoffice_indicators')
    .select('responsible_people')
    .eq('is_active', true)
    .not('responsible_people', 'eq', '[]');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate unique people from jsonb arrays
  const map = new Map<number, { name: string; count: number }>();
  for (const row of data ?? []) {
    const people = (row.responsible_people ?? []) as { id: number; name: string }[];
    for (const p of people) {
      if (!p.id) continue;
      const existing = map.get(p.id);
      if (existing) {
        existing.count++;
      } else {
        map.set(p.id, { name: p.name, count: 1 });
      }
    }
  }

  const result: MondayPerson[] = Array.from(map.entries())
    .map(([id, { name, count }]) => ({ id, name, indicator_count: count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return NextResponse.json(result);
}
