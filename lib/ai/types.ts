export interface LLMStreamOptions {
  systemPrompt: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  userMessage: string;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  streamChat(options: LLMStreamOptions): AsyncIterable<string>;
}
