import { createServiceClient } from '@/lib/supabase/server';
import SettingsClient, { type SyncLogEntry } from './SettingsClient';

export default async function SettingsPage() {
  // Prefetch last 20 sync log entries for SSR — client will refresh after each sync
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('monday_sync_log')
    .select('id, sync_type, board_id, triggered_by, status, items_fetched, items_synced, items_skipped, error_detail, metadata, started_at, finished_at')
    .order('started_at', { ascending: false })
    .limit(20);

  const initialLog: SyncLogEntry[] = (data ?? []) as SyncLogEntry[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-2xl md:text-3xl text-neutral-10 mb-2">
          Configurações
        </h1>
        <p className="text-neutral-8">
          Integrações e sincronizações com Monday.com
        </p>
      </div>

      <SettingsClient initialLog={initialLog} />
    </div>
  );
}
