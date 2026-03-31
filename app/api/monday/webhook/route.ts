import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { MONDAY_BOARDS } from '@/lib/services/monday';

/**
 * POST /api/monday/webhook
 *
 * Handles incoming Monday.com webhook events:
 *  1. Responds to the initial challenge handshake (synchronous, required by Monday)
 *  2. Verifies HMAC-SHA256 signature using MONDAY_WEBHOOK_SECRET
 *  3. Routes item-change events to the appropriate sync route (fire-and-forget)
 *
 * Setup in Monday.com:
 *   Admin → Integrations → Webhooks → Add Webhook
 *   URL: https://<your-domain>/api/monday/webhook
 *   Events: change_column_value, create_item, update_name (per board)
 *
 * Required env var: MONDAY_WEBHOOK_SECRET (set when registering the webhook in Monday)
 * If MONDAY_WEBHOOK_SECRET is not set, signature verification is skipped (dev only).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── 1. Read raw body BEFORE any JSON parsing ──────────────────────────────
  // request.text() and request.json() compete for the body stream; text must come first.
  const rawBody = await request.text();

  // ── 2. HMAC-SHA256 signature verification ─────────────────────────────────
  const secret = process.env.MONDAY_WEBHOOK_SECRET;
  if (secret) {
    const signature = request.headers.get('x-monday-signature');
    if (!signature) {
      return NextResponse.json({ error: 'Missing x-monday-signature header' }, { status: 401 });
    }

    const { createHmac, timingSafeEqual } = await import('crypto');
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

    // Length check before timingSafeEqual (which throws on mismatched lengths)
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    console.warn('[monday/webhook] MONDAY_WEBHOOK_SECRET not set — skipping signature verification');
  }

  // ── 3. Parse body ──────────────────────────────────────────────────────────
  let body: MondayWebhookBody;
  try {
    body = JSON.parse(rawBody) as MondayWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── 4. Challenge handshake (Monday sends this once when webhook is registered) ──
  if ('type' in body && body.type === 'challenge') {
    // Must respond synchronously with the exact challenge string
    return NextResponse.json({ challenge: body.challenge });
  }

  // ── 5. Route event by boardId ──────────────────────────────────────────────
  const event = (body as MondayWebhookEvent).event;
  if (!event?.boardId) {
    // Unrecognised shape — ack and ignore
    return NextResponse.json({ received: true, note: 'no event.boardId' });
  }

  const { boardId } = event;

  const appUrl = (
    process.env.NEXTAUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'http://localhost:3000'
  ).replace(/\/$/, '');

  const serviceHeader = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  };

  let syncEndpoint: string;
  let syncBody: Record<string, unknown>;

  switch (boardId) {
    case MONDAY_BOARDS.INDICADORES_E_METAS:
      syncEndpoint = `${appUrl}/api/monday/sync`;
      syncBody     = { year: new Date().getFullYear() };
      break;

    case MONDAY_BOARDS.RESULTADO_BOOKS_2025:
      syncEndpoint = `${appUrl}/api/monday/sync-books`;
      syncBody     = { year: 2025 };
      break;

    case MONDAY_BOARDS.COLABORADORES:
      syncEndpoint = `${appUrl}/api/monday/sync-colaboradores`;
      syncBody     = {};
      break;

    default:
      // Unknown board — log and acknowledge without triggering a sync
      console.warn(`[monday/webhook] Unhandled boardId: ${boardId}`);
      return NextResponse.json({ received: true, board_id: boardId, note: 'unhandled board' });
  }

  // ── 6. Fire-and-forget sync trigger ───────────────────────────────────────
  // Monday expects a 200 within ~3 seconds; full syncs take longer.
  // We trigger the sync asynchronously and return immediately.
  fetch(syncEndpoint, {
    method:  'POST',
    headers: serviceHeader,
    body:    JSON.stringify(syncBody),
  }).catch(err => console.error('[monday/webhook] Sync trigger failed:', err));

  // ── 7. Log to monday_sync_log (fire-and-forget) ───────────────────────────
  const supabase = createServiceClient();
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
        triggered_sync:   syncEndpoint,
      },
      finished_at: new Date().toISOString(),
    })
    .then(() => {})
    .catch(() => {});

  return NextResponse.json({
    received:   true,
    board_id:   boardId,
    triggered:  syncEndpoint,
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MondayChallengeBody {
  type: 'challenge';
  challenge: string;
}

interface MondayWebhookEvent {
  event?: {
    type:         string;
    boardId:      number;
    pulseId?:     number;   // item ID
    columnId?:    string;
    value?:       unknown;
    previousValue?: unknown;
  };
}

type MondayWebhookBody = MondayChallengeBody | MondayWebhookEvent;
