import type { LLMProvider, LLMStreamOptions } from '../types';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';

  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL ?? 'openclaw';
  }

  async *streamChat({ systemPrompt, history, userMessage, signal }: LLMStreamOptions): AsyncIterable<string> {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages, stream: true }),
        signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Ollama unreachable at ${this.baseUrl}: ${msg}`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama error ${res.status}: ${body}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          let obj: { message?: { content?: string }; done?: boolean };
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (obj.message?.content) yield obj.message.content;
          if (obj.done) return;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
