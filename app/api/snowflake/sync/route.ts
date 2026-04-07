import { NextRequest, NextResponse } from 'next/server';
import { bulkUpsertIndicatorData } from '@/lib/services/indicatorData';
import { createClient } from '@/lib/supabase/server';

const SNOWFLAKE_SIDECAR_URL = process.env.SNOWFLAKE_SIDECAR_URL ?? 'http://localhost:8001';
const SIDECAR_SECRET = process.env.SIDECAR_SECRET ?? '';

/**
 * POST /api/snowflake/sync
 * Triggers a data sync from Snowflake via the Python sidecar.
 * Protected: requires admin role OR a valid service-role Authorization header.
 *
 * Body: { sector?: string, year: number, month: number }
 */
export async function POST(request: NextRequest) {
  // Allow either admin user session OR a service-to-service bearer token
  const authHeader = request.headers.get('authorization');
  const isServiceCall = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (!isServiceCall) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .single();
    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }
  }

  const body = await request.json();
  const { sector, year, month } = body;

  if (!year || !month) {
    return NextResponse.json({ error: 'year and month are required' }, { status: 400 });
  }

  // Call sidecar
  let sidecarData: { rows: { indicator_id: string; year: number; month: number; real: number; meta?: number }[]; errors: string[] };
  try {
    const sidecarRes = await fetch(`${SNOWFLAKE_SIDECAR_URL}/sync-indicators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SIDECAR_SECRET}`,
      },
      body: JSON.stringify({ sector, year, month }),
    });

    if (!sidecarRes.ok) {
      const err = await sidecarRes.text();
      return NextResponse.json({ error: `Sidecar error: ${err}` }, { status: 502 });
    }

    sidecarData = await sidecarRes.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot reach Snowflake sidecar at ${SNOWFLAKE_SIDECAR_URL}` },
      { status: 503 }
    );
  }

  // Upsert into Supabase
  const { synced, errors: dbErrors } = await bulkUpsertIndicatorData(
    sidecarData.rows,
    undefined // system sync, no user id
  );

  return NextResponse.json({
    success: true,
    synced,
    sidecar_errors: sidecarData.errors,
    db_errors: dbErrors,
    mapping_count: sidecarData.rows.length,
  });
}
