'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, User, Send, Square, Trash2, RefreshCw } from 'lucide-react';
import type { ChatMessage, StreamChunk } from '@/types/ai';

const CONTEXT_OPTIONS = [
  { value: '', label: 'Geral' },
  { value: 'indicators', label: 'Indicadores' },
  { value: 'books', label: 'Books' },
  { value: 'monday', label: 'Monday ao vivo' },
];

const LLM_PROVIDER = process.env.NEXT_PUBLIC_LLM_PROVIDER ?? 'ollama';
const MODEL_LABEL = process.env.NEXT_PUBLIC_OLLAMA_MODEL ?? 'openclaw';

export default function AITerminal() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [contextHint, setContextHint] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateLastMessage = useCallback((content: string) => {
    setMessages(prev => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last?.role === 'assistant') {
        copy[copy.length - 1] = { ...last, content };
      }
      return copy;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);

    const history = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history, context_hint: contextHint || undefined }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        updateLastMessage(`Erro: ${err.error ?? res.statusText}`);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          if (chunk.type === 'delta') {
            accumulated += chunk.content;
            updateLastMessage(accumulated);
          } else if (chunk.type === 'error') {
            updateLastMessage(`Erro: ${chunk.message}`);
            break;
          } else if (chunk.type === 'done') {
            break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateLastMessage('Conexão interrompida. Tente novamente.');
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, messages, contextHint, updateLastMessage]);

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const handleClear = () => {
    if (isStreaming) handleStop();
    setMessages([]);
    setSyncResult(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/monday/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: new Date().getFullYear() }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncResult(`Sync OK: ${data.synced} linhas atualizadas (${data.matched} indicadores correspondidos, ${data.unmatched} não encontrados)`);
      } else {
        setSyncResult(`Erro: ${data.error}`);
      }
    } catch {
      setSyncResult('Falha na conexão com o servidor.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] bg-white rounded-xl border border-neutral-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-2 bg-white">
        <div className="flex items-center gap-3">
          <Bot className="w-5 h-5 text-suno-red" />
          <span className="font-semibold text-neutral-10">AI Terminal</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-1 text-neutral-5 font-mono">
            {MODEL_LABEL} · {LLM_PROVIDER}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={isSyncing}
            title="Sincronizar dados do Monday.com"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-neutral-2 text-neutral-7 hover:bg-neutral-1 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Sincronizando…' : 'Sync Monday'}
          </button>
          <button
            onClick={handleClear}
            title="Limpar conversa"
            className="p-1.5 rounded-lg text-neutral-5 hover:bg-neutral-1 hover:text-neutral-10 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className="px-4 py-2 text-xs bg-neutral-1 border-b border-neutral-2 text-neutral-7">
          {syncResult}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-neutral-4 select-none">
            <Bot className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-sm font-medium">Como posso ajudar?</p>
            <p className="text-xs mt-1 opacity-70">Pergunte sobre indicadores, books ou metas</p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {[
                'Quais indicadores estão abaixo da meta?',
                'Qual o alcance do book de março?',
                'Explique a metodologia de cálculo',
              ].map(s => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs px-3 py-1.5 rounded-full border border-neutral-2 text-neutral-7 hover:bg-neutral-1 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-neutral-1 flex items-center justify-center mt-0.5">
                <Bot className="w-4 h-4 text-neutral-7" />
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-suno-red text-white rounded-tr-sm'
                  : 'bg-neutral-1 text-neutral-10 rounded-tl-sm'
              }`}
            >
              {msg.content || (
                <span className="flex gap-1 items-center text-neutral-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-4 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-4 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-neutral-4 animate-bounce [animation-delay:300ms]" />
                </span>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-suno-red/10 flex items-center justify-center mt-0.5">
                <User className="w-4 h-4 text-suno-red" />
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-neutral-2 p-3 bg-white">
        <div className="flex items-end gap-2">
          <select
            value={contextHint}
            onChange={(e) => setContextHint(e.target.value)}
            className="flex-shrink-0 text-xs border border-neutral-2 rounded-lg px-2 py-2 bg-white text-neutral-7 focus:outline-none focus:ring-1 focus:ring-suno-red"
          >
            {CONTEXT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre indicadores ou books… (Ctrl+Enter para enviar)"
            rows={1}
            disabled={isStreaming}
            className="flex-1 resize-none text-sm border border-neutral-2 rounded-xl px-3 py-2 bg-white text-neutral-10 placeholder:text-neutral-4 focus:outline-none focus:ring-1 focus:ring-suno-red disabled:opacity-60 max-h-32 overflow-y-auto"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />

          {isStreaming ? (
            <button
              onClick={handleStop}
              className="flex-shrink-0 p-2.5 rounded-xl bg-suno-red/10 text-suno-red hover:bg-suno-red/20 transition-colors"
              title="Parar"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className="flex-shrink-0 p-2.5 rounded-xl bg-suno-red text-white hover:bg-suno-red/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Enviar (Ctrl+Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
