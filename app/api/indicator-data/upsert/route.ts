import { NextRequest, NextResponse } from 'next/server';
import { upsertIndicatorData } from '@/lib/services/indicatorData';
import { getCurrentUser } from '@/lib/auth/utils';

/**
 * POST /api/indicator-data/upsert
 * Called by the employee dashboard when editing a manual (Category 3/4) indicator value.
 *
 * Body: { indicator_id, year, month, real?, meta? }
 */
export async function POST(request: NextRequest) {
  // Use getCurrentUser to get the public.users.id (not the auth UUID).
  // After migration 012, updated_by FK references public.users.id, not auth.users.id.
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { indicator_id, year, month, real, meta } = body;

  if (!indicator_id || !year || !month) {
    return NextResponse.json(
      { error: 'indicator_id, year, and month are required' },
      { status: 400 }
    );
  }

  if (month < 1 || month > 12) {
    return NextResponse.json({ error: 'month must be between 1 and 12' }, { status: 400 });
  }

  const ok = await upsertIndicatorData({
    indicator_id,
    year,
    month,
    real: real !== undefined ? Number(real) : undefined,
    meta: meta !== undefined ? Number(meta) : undefined,
    updated_by: user.id,
  });

  if (!ok) {
    return NextResponse.json(
      { error: 'Failed to update indicator data. The indicator may be read-only (Category 1).' },
      { status: 403 }
    );
  }

  return NextResponse.json({ success: true });
}
