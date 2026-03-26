export type LLMProviderName = 'ollama' | 'claude' | 'openai';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface ChatRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  context_hint?: string; // e.g. 'indicator:<id>', 'book:<id>', 'monday'
}

export type StreamChunk =
  | { type: 'delta'; content: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
