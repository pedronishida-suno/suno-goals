'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, BookOpen, Users, BarChart3, Database,
  Zap, CheckCircle, XCircle, Clock, AlertCircle, CalendarClock,
} from 'lucide-react';

const SUPABASE_URL = 'https://iywpulmxiggcohdefgim.supabase.co';
const EDGE_FN_BASE = `${SUPABASE_URL}/functions/v1`;

// ── Types ─────────────────────────────────────────────────────────────────────

type SyncStatus = 'idle' | 'loading' | 'success' | 'error';

interface SyncResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

interface SyncButtonState {
  status: SyncStatus;
  result: SyncResult | null;
}

export interface SyncLogEntry {
  id:            string;
  sync_type:     string;
  board_id:      number | null;
  triggered_by:  string | null;
  status:        string;
  items_fetched: number | null;
  items_synced:  number | null;
  items_skipped: number | null;
  error_detail:  string | null;
  metadata:      Record<string, unknown> | null;
  started_at:    string;
  finished_at:   string | null;
}

const SYNC_CONFIGS = [
  {
    key:         'catalog',
    label:       'Catálogo de Indicadores',
    description: 'Sincroniza nomes, formatos e responsáveis do board principal',
    icon:        Database,
    endpoint:    `${EDGE_FN_BASE}/sync-catalog`,
    body:        {},
    useServiceKey: true,
  },
  {
    key:         'data',
    label:       'Dados Mensais',
    description: 'Sincroniza metas e realizados do ano corrente',
    icon:        BarChart3,
    endpoint:    `${EDGE_FN_BASE}/sync-indicator-data`,
    body:        () => ({ year: new Date().getFullYear() }),
    useServiceKey: true,
  },
  {
    key:         'colaboradores',
    label:       'Colaboradores',
    description: 'Atualiza perfis de usuários a partir do board de pessoas',
    icon:        Users,
    endpoint:    `${EDGE_FN_BASE}/sync-colaboradores`,
    body:        {},
    useServiceKey: true,
  },
  {
    key:         'books',
    label:       'Resultado Books',
    description: 'Sincroniza dados do board Resultado Books 2025',
    icon:        BookOpen,
    endpoint:    `${EDGE_FN_BASE}/sync-resultado-books`,
    body:        { year: 2025 },
    useServiceKey: true,
  },
] as const;

type SyncKey = typeof SYNC_CONFIGS[number]['key'] | 'all';

const INITIAL_STATES: Record<SyncKey, SyncButtonState> = {
  catalog:       { status: 'idle', result: null },
  data:          { status: 'idle', result: null },
  colaboradores: { status: 'idle', result: null },
  books:         { status: 'idle', result: null },
  all:           { status: 'idle', result: null },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSuccessMessage(key: string, data: Record<string, unknown>): string {
  switch (key) {
    case 'catalog':
      return `${data.synced ?? data.upserted ?? data.valid_items ?? '?'} indicadores sincronizados`;
    case 'data':
      return `${data.synced ?? '?'} linhas · ${data.fetched ?? '?'} itens buscados`;
    case 'colaboradores':
      return `${data.synced ?? data.updated ?? '?'} usuários atualizados · ${data.not_in_supabase_count ?? 0} não encontrados`;
    case 'books':
      return `${data.data_rows_synced ?? data.synced ?? '?'} linhas · ${data.books_created ?? 0} books criados`;
    default:
      return 'Sincronização concluída';
  }
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day:    '2-digit',
    month:  '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

const SYNC_TYPE_LABEL: Record<string, string> = {
  catalog:         'Catálogo',
  indicator_data:  'Dados Mensais',
  colaboradores:   'Colaboradores',
  resultado_books: 'Resultado Books',
  webhook:         'Webhook',
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface SyncButtonProps {
  label:       string;
  description: string;
  Icon:        React.ComponentType<{ className?: string }>;
  state:       SyncButtonState;
  disabled:    boolean;
  onClick:     () => void;
  fullWidth?:  boolean;
}

function SyncButton({ label, description, Icon, state, disabled, onClick, fullWidth }: SyncButtonProps) {
  const isLoading = state.status === 'loading';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'flex items-start gap-4 p-4 rounded-xl border text-left transition-all',
        fullWidth ? 'w-full' : '',
        disabled
          ? 'opacity-60 cursor-not-allowed bg-neutral-1 border-neutral-2'
          : 'hover:border-suno-orange hover:bg-suno-orange/5 border-neutral-2 bg-white cursor-pointer',
      ].join(' ')}
    >
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">
        {isLoading
          ? <RefreshCw className="w-5 h-5 text-suno-orange animate-spin" />
          : <Icon className="w-5 h-5 text-neutral-6" />
        }
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-medium text-sm text-neutral-10">{label}</span>
          {state.status === 'success' && (
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
          )}
          {state.status === 'error' && (
            <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          )}
        </div>
        <p className="text-xs text-neutral-6 leading-relaxed">{description}</p>
        {state.result && (
          <p className={[
            'text-xs mt-1.5 font-medium',
            state.status === 'success' ? 'text-green-600' : 'text-red-600',
          ].join(' ')}>
            {state.result.message}
          </p>
        )}
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface CronJob {
  jobid:       number;
  jobname:     string;
  schedule:    string;
  active:      boolean;
  last_run_at: string | null;
  last_status: string | null;
}

interface Props {
  initialLog: SyncLogEntry[];
}

export default function SettingsClient({ initialLog }: Props) {
  const [states, setStates]     = useState<Record<SyncKey, SyncButtonState>>(INITIAL_STATES);
  const [syncLog, setSyncLog]   = useState<SyncLogEntry[]>(initialLog);
  const [logLoading, setLogLoading] = useState(false);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);

  const anyLoading = Object.values(states).some(s => s.status === 'loading');

  const fetchLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const res = await fetch('/api/monday/sync-log?limit=20');
      if (res.ok) setSyncLog(await res.json());
    } finally {
      setLogLoading(false);
    }
  }, []);

  const fetchCronJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/monday/cron-status');
      if (res.ok) {
        const json = await res.json() as { jobs: CronJob[] };
        setCronJobs(json.jobs ?? []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void fetchLog();
    void fetchCronJobs();
  }, [fetchLog, fetchCronJobs]);

  const runSync = useCallback(async (key: SyncKey, endpoint: string, body: Record<string, unknown>) => {
    setStates(prev => ({ ...prev, [key]: { status: 'loading', result: null } }));
    try {
      // Edge Functions are deployed with --no-verify-jwt; anon key is sufficient.
      const isEdgeFn = endpoint.includes('supabase.co/functions');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (isEdgeFn) {
        // Supabase Edge Functions need an apikey header even with --no-verify-jwt
        headers['apikey'] = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
        headers['Authorization'] = `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''}`;
      }
      const res = await fetch(endpoint, {
        method:  'POST',
        headers,
        body:    JSON.stringify(body),
      });
      const data = await res.json() as Record<string, unknown>;

      if (!res.ok || data.error) {
        setStates(prev => ({
          ...prev,
          [key]: {
            status: 'error',
            result: { success: false, message: String(data.error ?? `HTTP ${res.status}`), details: data },
          },
        }));
      } else {
        setStates(prev => ({
          ...prev,
          [key]: {
            status: 'success',
            result: { success: true, message: buildSuccessMessage(key, data), details: data },
          },
        }));
      }
    } catch (err) {
      setStates(prev => ({
        ...prev,
        [key]: {
          status: 'error',
          result: { success: false, message: String(err) },
        },
      }));
    }
    await fetchLog();
  }, [fetchLog]);

  const handleSyncAll = useCallback(async () => {
    setStates(prev => ({ ...prev, all: { status: 'loading', result: null } }));
    for (const cfg of SYNC_CONFIGS) {
      const body = typeof cfg.body === 'function' ? cfg.body() : cfg.body;
      await runSync(cfg.key, cfg.endpoint, body);
    }
    setStates(prev => ({
      ...prev,
      all: {
        status: 'success',
        result: { success: true, message: 'Todas as sincronizações concluídas' },
      },
    }));
  }, [runSync]);

  return (
    <div className="space-y-6">
      {/* ── Monday.com Sync Panel ──────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-2 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-1">
          <Zap className="w-5 h-5 text-suno-orange" />
          <h2 className="font-display font-semibold text-lg text-neutral-10">
            Sincronização Monday.com
          </h2>
        </div>
        <p className="text-sm text-neutral-6 mb-4">
          Use <strong>Sincronizar Tudo</strong> para importar todos os dados já existentes no Monday.com
          (backfill inicial). Após isso, o webhook e o agendamento diário mantêm os dados
          atualizados automaticamente.
        </p>

        {/* Individual sync buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          {SYNC_CONFIGS.map(cfg => {
            const body = typeof cfg.body === 'function' ? cfg.body() : cfg.body;
            return (
              <SyncButton
                key={cfg.key}
                label={cfg.label}
                description={cfg.description}
                Icon={cfg.icon}
                state={states[cfg.key]}
                disabled={anyLoading}
                onClick={() => void runSync(cfg.key, cfg.endpoint, body)}
              />
            );
          })}
        </div>

        {/* Sync All */}
        <div className="border-t border-neutral-2 pt-3">
          <SyncButton
            label="Sincronizar Tudo"
            description="Executa todas as sincronizações em sequência (catálogo primeiro)"
            Icon={RefreshCw}
            state={states.all}
            disabled={anyLoading}
            onClick={() => void handleSyncAll()}
            fullWidth
          />
        </div>
      </div>

      {/* ── Auto-Schedule Status ───────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-2 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <CalendarClock className="w-5 h-5 text-neutral-6" />
          <h2 className="font-display font-semibold text-lg text-neutral-10">
            Agendamento Automático
          </h2>
        </div>
        <p className="text-sm text-neutral-6 mb-4">
          Sincronização diária via <code className="text-xs bg-neutral-1 px-1 py-0.5 rounded">pg_cron</code>.
          Roda automaticamente todos os dias sem intervenção manual.
        </p>
        {cronJobs.length === 0 ? (
          <p className="text-xs text-neutral-5">Nenhum job agendado encontrado.</p>
        ) : (
          <div className="space-y-2">
            {cronJobs.map(job => {
              const labelMap: Record<string, string> = {
                'monday-sync-catalog':       'Catálogo de Indicadores',
                'monday-sync-indicator-data': 'Dados Mensais',
              };
              const scheduleLabel: Record<string, string> = {
                '0 5 * * *': 'Todo dia às 02:00 BRT',
                '0 6 * * *': 'Todo dia às 03:00 BRT',
              };
              return (
                <div key={job.jobid} className="flex items-center justify-between bg-neutral-1 rounded-lg px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-neutral-10">
                      {labelMap[job.jobname] ?? job.jobname}
                    </p>
                    <p className="text-xs text-neutral-6">
                      {scheduleLabel[job.schedule] ?? job.schedule}
                      {job.last_run_at && (
                        <> · Última execução: {formatDate(job.last_run_at)}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.last_status === 'succeeded' && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                    {job.last_status === 'failed' && (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className={[
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      job.active
                        ? 'bg-green-50 text-green-700'
                        : 'bg-neutral-2 text-neutral-6',
                    ].join(' ')}>
                      {job.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Webhook Info ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-2 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <AlertCircle className="w-5 h-5 text-neutral-6" />
          <h2 className="font-display font-semibold text-lg text-neutral-10">
            Webhook (Tempo Real)
          </h2>
        </div>
        <p className="text-sm text-neutral-6 mb-3">
          Registre o endpoint abaixo no Monday.com para sincronização instantânea quando itens
          forem alterados.
        </p>
        <div className="flex items-center gap-2 bg-neutral-1 rounded-lg px-3 py-2">
          <code className="text-xs text-neutral-8 font-mono break-all">
            {`${SUPABASE_URL}/functions/v1/monday-webhook`}
          </code>
        </div>
        <p className="text-xs text-neutral-5 mt-2">
          Monday: Automações → Webhook → cole a URL acima · desafio de verificação é respondido
          automaticamente.
        </p>
      </div>

      {/* ── Sync Log ──────────────────────────────────────────────────────── */}
      <div className="bg-white border border-neutral-2 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-neutral-6" />
            <h2 className="font-display font-semibold text-lg text-neutral-10">
              Histórico de Sincronizações
            </h2>
          </div>
          <button
            onClick={() => void fetchLog()}
            disabled={logLoading}
            className="text-xs text-neutral-6 hover:text-neutral-10 transition-colors flex items-center gap-1"
          >
            <RefreshCw className={['w-3.5 h-3.5', logLoading ? 'animate-spin' : ''].join(' ')} />
            Atualizar
          </button>
        </div>

        {syncLog.length === 0 ? (
          <p className="text-sm text-neutral-5 text-center py-8">
            Nenhuma sincronização registrada ainda.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-2">
                  <th className="text-left text-xs font-medium text-neutral-6 pb-2 pr-4">Tipo</th>
                  <th className="text-left text-xs font-medium text-neutral-6 pb-2 pr-4">Status</th>
                  <th className="text-right text-xs font-medium text-neutral-6 pb-2 pr-4">Itens</th>
                  <th className="text-right text-xs font-medium text-neutral-6 pb-2 pr-4">Duração</th>
                  <th className="text-left text-xs font-medium text-neutral-6 pb-2">Início</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-1">
                {syncLog.map(entry => (
                  <tr key={entry.id} className="hover:bg-neutral-1/50 transition-colors">
                    <td className="py-2 pr-4 font-medium text-neutral-10">
                      {SYNC_TYPE_LABEL[entry.sync_type] ?? entry.sync_type}
                    </td>
                    <td className="py-2 pr-4">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="py-2 pr-4 text-right text-neutral-6">
                      {entry.items_synced != null
                        ? `${entry.items_synced}${entry.items_fetched != null ? ` / ${entry.items_fetched}` : ''}`
                        : '—'}
                    </td>
                    <td className="py-2 pr-4 text-right text-neutral-6">
                      {formatDuration(entry.started_at, entry.finished_at)}
                    </td>
                    <td className="py-2 text-neutral-6 whitespace-nowrap">
                      {formatDate(entry.started_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle className="w-3 h-3" />Sucesso</span>;
    case 'partial':
      return <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-full"><AlertCircle className="w-3 h-3" />Parcial</span>;
    case 'error':
      return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full"><XCircle className="w-3 h-3" />Erro</span>;
    case 'started':
      return <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full"><RefreshCw className="w-3 h-3 animate-spin" />Em andamento</span>;
    default:
      return <span className="text-xs text-neutral-6">{status}</span>;
  }
}
