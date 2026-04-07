import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/monday/cron-status
 *
 * Returns the status and schedule of the pg_cron jobs that auto-sync
 * Monday.com data into Supabase daily.
 * Protected: admin session or service-role bearer token.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
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

  // ── Query cron.job ──────────────────────────────────────────────────────────
  const supabase = createServiceClient();

  // cron.job is in the cron schema — accessible via rpc or raw query through service role
  const { data: jobs, error: jobsErr } = await supabase
    .rpc('get_monday_cron_jobs') as { data: CronJob[] | null; error: unknown };

  if (jobsErr) {
    // Fallback: return empty list if pg_cron isn't configured yet
    return NextResponse.json({ jobs: [], error: String(jobsErr) });
  }

  return NextResponse.json({ jobs: jobs ?? [] });
}

interface CronJob {
  jobid:        number;
  jobname:      string;
  schedule:     string;
  active:       boolean;
  last_run_at:  string | null;
  last_status:  string | null;
  next_run_at:  string | null;
}
