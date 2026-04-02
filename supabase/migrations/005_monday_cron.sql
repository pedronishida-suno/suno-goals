-- =====================================================
-- MIGRATION 005 — Monday.com Sync Auto-Schedule (pg_cron + pg_net)
-- Schedules daily Edge Function calls via pg_cron.
-- Run AFTER 004_monday_sync_log.sql
--
-- Cron schedule (UTC):
--   05:00 UTC = 02:00 BRT → sync-catalog      (catalog of indicators)
--   06:00 UTC = 03:00 BRT → sync-indicator-data (monthly KPI values)
-- =====================================================

-- 1. Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron;

-- 2. Helper function to (re)create the cron jobs — SECURITY DEFINER so it
--    runs as the function owner (postgres) and can call cron.schedule().
CREATE OR REPLACE FUNCTION public.setup_monday_cron_jobs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  svc  text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5d3B1bG14aWdnY29oZGVmZ2ltIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDQ1Mjc2OCwiZXhwIjoyMDkwMDI4NzY4fQ.JNGDhDHaXuiDC54DS8sQ6hEJBNhUghdSyY_uThSP5gU';
  base text := 'https://iywpulmxiggcohdefgim.supabase.co/functions/v1';
BEGIN
  -- Remove old jobs (idempotent)
  PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN ('monday-sync-catalog', 'monday-sync-indicator-data');

  -- 02:00 BRT (05:00 UTC): sync indicator catalog
  PERFORM cron.schedule(
    'monday-sync-catalog',
    '0 5 * * *',
    format(
      $sql$SELECT net.http_post(
        url     := '%s/sync-catalog',
        headers := '{"Authorization":"Bearer %s","Content-Type":"application/json"}'::jsonb,
        body    := '{}'::jsonb
      )$sql$,
      base, svc
    )
  );

  -- 03:00 BRT (06:00 UTC): sync monthly indicator data (current year)
  PERFORM cron.schedule(
    'monday-sync-indicator-data',
    '0 6 * * *',
    format(
      $sql$SELECT net.http_post(
        url     := '%s/sync-indicator-data',
        headers := '{"Authorization":"Bearer %s","Content-Type":"application/json"}'::jsonb,
        body    := jsonb_build_object('year', extract(year from now())::int)
      )$sql$,
      base, svc
    )
  );
END;
$$;

-- 3. Helper view: get_monday_cron_jobs — used by /api/monday/cron-status
CREATE OR REPLACE FUNCTION public.get_monday_cron_jobs()
RETURNS TABLE(
  jobid       bigint,
  jobname     text,
  schedule    text,
  active      boolean,
  last_run_at timestamptz,
  last_status text
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    j.jobid,
    j.jobname,
    j.schedule,
    j.active,
    d.start_time  AS last_run_at,
    d.status      AS last_status
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT start_time, status
    FROM cron.job_run_details r
    WHERE r.jobid = j.jobid
    ORDER BY start_time DESC
    LIMIT 1
  ) d ON true
  WHERE j.jobname LIKE 'monday-%'
  ORDER BY j.jobname;
$$;

-- 4. Execute immediately to register the jobs
SELECT public.setup_monday_cron_jobs();

-- 5. Verify
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname LIKE 'monday-%';
