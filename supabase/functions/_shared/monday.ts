import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const MONDAY_API_URL = 'https://api.monday.com/v2'

export const BOARDS = {
  INDICADORES_E_METAS: 3896178865,
  RESULTADO_BOOKS_2025: 18397693246,
  COLABORADORES: 3958295293,
} as const

// Column IDs for INDICADORES_E_METAS board (year 2026)
export const COL_2026 = {
  meta: [
    'numeric',   // Jan
    'numeric3',  // Feb
    'numeric2',  // Mar
    'numeric32', // Apr
    'numeric39', // May
    'numeric0',  // Jun
    'numeric1',  // Jul
    'numeric04', // Aug
    'numeric17', // Sep
    'numeric7',  // Oct
    'numeric05', // Nov
    'numeric6',  // Dec
  ],
  real: [
    'numeric742',  // Jan
    'numeric30',   // Feb
    'numeric00',   // Mar
    'numeric25',   // Apr
    'numeric4',    // May
    'numeric307',  // Jun
    'numeric207',  // Jul
    'numeric311',  // Aug
    'numeric759',  // Sep
    'numeric26',   // Oct
    'numeric58',   // Nov
    'numeric57',   // Dec
  ],
  // Catalog columns
  friendlyName:    'text2',
  indicatorKey:    'text7',
  description:     'text23',
  status:          'color91',
  direction:       'color0',
  format:          'color2',
  aggregationType: 'color8',
  responsible:     'multiple_person',
} as const

// Column IDs for RESULTADO_BOOKS_2025 board
export const COL_BOOKS = {
  indicatorName: 'text_mm01y6xx',
  indicatorKey:  'text_mm01q1tw',
  realMonths: [
    'numeric_mm01efr5', // Jan
    'numeric_mm016cnq', // Feb
    'numeric_mm011qwt', // Mar
    'numeric_mm01g2k8', // Apr
    'numeric_mm01mcwe', // May
    'numeric_mm01wzrq', // Jun
    'numeric_mm0135vs', // Jul
    'numeric_mm01zh0q', // Aug
    'numeric_mm0198er', // Sep
    'numeric_mm01k98j', // Oct
    'numeric_mm01h8yt', // Nov
    'numeric_mm01a1eg', // Dec
  ],
  responsible: 'multiple_person_mm02xr6h',
} as const

// Column IDs for COLABORADORES board (3958295293)
export const COL_COLABORADORES = {
  email:         'text42',   // Email do colaborador
  manager_email: 'text3',    // Email do gestor/manager
  status:        'status8',  // Status colaborador (Ativo/Inativo)
  area:          'status3',  // Área / department
  diretoria:     'status5',  // Diretoria
  grade:         'status6',  // Grade
  negocio:       'status99', // Negócio / Business Unit
  nivel:         'status00', // Nível (for role mapping)
} as const

export function makeSupabase() {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key, {
    auth: { persistSession: false },
  })
}

export async function mondayGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const apiKey = Deno.env.get('MONDAY_API_KEY')!
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new Error(`Monday.com API ${res.status}: ${await res.text()}`)
  }
  const json = await res.json() as { data: T; errors?: { message: string }[] }
  if (json.errors?.length) {
    throw new Error(`Monday GraphQL: ${json.errors.map(e => e.message).join(', ')}`)
  }
  return json.data
}

/** Open a sync_log row and return its id + a finisher function. */
export async function openSyncLog(
  supabase: ReturnType<typeof makeSupabase>,
  syncType: 'catalog' | 'indicator_data' | 'colaboradores' | 'resultado_books' | 'webhook',
  boardId: number,
  triggeredBy = 'edge-function',
  metadata: Record<string, unknown> = {},
) {
  const { data } = await supabase
    .from('monday_sync_log')
    .insert({ sync_type: syncType, board_id: boardId, triggered_by: triggeredBy, status: 'started', metadata })
    .select('id')
    .single()

  const logId: string | undefined = data?.id

  const finish = async (
    status: 'success' | 'partial' | 'error',
    counts: { fetched: number; synced: number; skipped: number },
    meta: Record<string, unknown>,
    errorDetail?: string,
  ) => {
    if (!logId) return
    await supabase
      .from('monday_sync_log')
      .update({
        status,
        items_fetched: counts.fetched,
        items_synced:  counts.synced,
        items_skipped: counts.skipped,
        error_detail:  errorDetail ?? null,
        metadata:      meta,
        finished_at:   new Date().toISOString(),
      })
      .eq('id', logId)
  }

  return { logId, finish }
}

export function normalize(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Parse a Monday numeric column value (stored as JSON string "123.45" or null). */
export function parseNum(value: string | null | undefined): number | null {
  if (value == null || value === '') return null
  try {
    const n = Number(JSON.parse(value))
    return isNaN(n) ? null : n
  } catch {
    const n = Number(value)
    return isNaN(n) ? null : n
  }
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}
