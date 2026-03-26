import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getLLMProvider } from '@/lib/ai/factory';
import { buildContext } from '@/lib/ai/context-builder';
import { buildSystemPrompt } from '@/lib/ai/prompt-templates';
import type { ChatRequest, StreamChunk } from '@/types/ai';

/**
 * POST /api/ai/chat
 * Streaming SSE endpoint for the AI Terminal.
 * Auth: any authenticated user (employee, manager, admin).
 *
 * Body: ChatRequest { message, history, context_hint? }
 * Response: text/event-stream with SSE chunks
 */
export async function POST(request: NextRequest) {
  // Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Parse body
  let body: ChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message, history = [], context_hint } = body;
  if (!message?.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  // Get user name for system prompt
  const { data: userData } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', user.id)
    .single();
  const userName = userData?.full_name ?? user.email ?? 'Usuário';

  // Build context + system prompt
  const context = await buildContext({ message, contextHint: context_hint, userId: user.id });
  const systemPrompt = buildSystemPrompt(
    context,
    new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
    userName
  );

  // Get LLM provider
  let provider;
  try {
    provider = await getLLMProvider();
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  // Stream response
  const abortController = new AbortController();
  request.signal.addEventListener('abort', () => abortController.abort());

  const encoder = new TextEncoder();

  function sseChunk(chunk: StreamChunk): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const delta of provider.streamChat({
          systemPrompt,
          history,
          userMessage: message,
          signal: abortController.signal,
        })) {
          if (abortController.signal.aborted) break;
          controller.enqueue(sseChunk({ type: 'delta', content: delta }));
        }
        controller.enqueue(sseChunk({ type: 'done' }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(sseChunk({ type: 'error', message: msg }));
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
