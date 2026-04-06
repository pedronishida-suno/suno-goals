/**
 * monday-webhook — Edge Function
 * Receives real-time Monday.com webhook events.
 *
 * Handles:
 *   1. Challenge handshake (Monday sends once when webhook is registered)
 *   2. HMAC-SHA256 signature verification (MONDAY_WEBHOOK_SECRET)
 *   3. Routes item-change events to the appropriate sync Edge Function
 *
 * POST https://{project}.supabase.co/functions/v1/monday-webhook
 *
 * Register in Monday.com:
 *   Admin → Integrations → Webhooks → Add Webhook
 *   URL: https://iywpulmxiggcohdefgim.supabase.co/functions/v1/monday-webhook
 *   Events: change_column_value, create_item, update_name
 */
import {
  makeSupabase,
  corsHeaders,
  BOARDS,
} from '../_shared/monday.ts'

const PROJECT_URL = 'https://iywpulmxiggcohdefgim.supabase.co'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  // 1. Read raw body before any parsing (required for HMAC)
  const rawBody = await req.text()

  // 2. HMAC-SHA256 signature verification
  const secret = Deno.env.get('MONDAY_WEBHOOK_SECRET')
  if (secret) {
    const signature = req.headers.get('x-monday-signature')
    if (!signature) {
      return Response.json({ error: 'Missing x-monday-signature' }, { status: 401 })
    }

    const keyData = new TextEncoder().encode(secret)
    const bodyData = new TextEncoder().encode(rawBody)
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sigBuffer = await crypto.subtle.sign('HMAC', cryptoKey, bodyData)
    const sigHex = Array.from(new Uint8Array(sigBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    const expected = `sha256=${sigHex}`

    if (signature !== expected) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  // 3. Parse body
  let body: MondayWebhookBody
  try {
    body = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // 4. Challenge handshake
  if ('challenge' in body && body.challenge) {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 5. Route by boardId
  const event = (body as MondayWebhookEvent).event
  if (!event?.boardId) {
    return Response.json({ received: true, note: 'no event.boardId' })
  }

  const { boardId } = event
  const supabase = makeSupabase()

  // Determine which sync function to call
  type SyncTarget = {
    functionName: string
    syncType:     'catalog' | 'indicator_data' | 'colaboradores' | 'resultado_books' | 'webhook'
    body:         Record<string, unknown>
  }

  let target: SyncTarget | null = null

  switch (boardId) {
    case BOARDS.INDICADORES_E_METAS:
      target = {
        functionName: 'sync-indicator-data',
        syncType:     'indicator_data',
        body:         { year: new Date().getFullYear() },
      }
      break

    case BOARDS.RESULTADO_BOOKS_2025:
      target = {
        functionName: 'sync-resultado-books',
        syncType:     'resultado_books',
        body:         { year: 2025 },
      }
      break

    case BOARDS.COLABORADORES:
      target = {
        functionName: 'sync-colaboradores',
        syncType:     'colaboradores',
        body:         {},
      }
      break

    default:
      console.warn(`[monday-webhook] Unhandled boardId: ${boardId}`)
      return Response.json({ received: true, board_id: boardId, note: 'unhandled board' })
  }

  // 6. Log webhook receipt (fire-and-forget)
  supabase
    .from('monday_sync_log')
    .insert({
      sync_type:    'webhook',
      board_id:     boardId,
      triggered_by: 'webhook',
      status:       'success',
      metadata: {
        event_type:       event.type,
        pulse_id:         event.pulseId,
        column_id:        event.columnId,
        triggered_sync:   target.functionName,
      },
      finished_at: new Date().toISOString(),
    })
    .then(() => {})
    .catch(() => {})

  // 7. Fire-and-forget: call the target sync function
  // Monday expects a 200 within ~3 seconds; syncs take longer
  const syncUrl = `${PROJECT_URL}/functions/v1/${target.functionName}`
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  fetch(syncUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(target.body),
  }).catch(err => console.error(`[monday-webhook] Failed to trigger ${target!.functionName}:`, err))

  return Response.json({
    received:  true,
    board_id:  boardId,
    triggered: target.functionName,
  })
})

// ─── Types ────────────────────────────────────────────────────────────────────

interface MondayChallenge {
  challenge: string
}

interface MondayWebhookEvent {
  event?: {
    type:            string
    boardId:         number
    pulseId?:        number
    columnId?:       string
    value?:          unknown
    previousValue?:  unknown
  }
}

type MondayWebhookBody = MondayChallenge | MondayWebhookEvent
