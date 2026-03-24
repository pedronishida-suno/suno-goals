import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/snowflake/trigger
 * Manual trigger endpoint callable from the admin panel.
 * Syncs the current month for a given sector.
 *
 * Body: { sector?: string }
 */
export async function POST(request: NextRequest) {
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

  const body = await request.json().catch(() => ({}));
  const { sector } = body;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // Call the sync endpoint with service-role auth to bypass session check
  const syncRes = await fetch(
    `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/api/snowflake/sync`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ sector, year, month }),
    }
  );

  const result = await syncRes.json();
  return NextResponse.json(result, { status: syncRes.status });
}
