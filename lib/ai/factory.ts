import type { LLMProvider } from './types';

export async function getLLMProvider(): Promise<LLMProvider> {
  const provider = (process.env.LLM_PROVIDER ?? 'ollama') as string;

  switch (provider) {
    case 'ollama': {
      const { OllamaProvider } = await import('./providers/ollama');
      return new OllamaProvider();
    }
    case 'claude': {
      const { ClaudeProvider } = await import('./providers/claude');
      return new ClaudeProvider();
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./providers/openai');
      return new OpenAIProvider();
    }
    default:
      throw new Error(`Unknown LLM_PROVIDER: "${provider}". Valid values: ollama, claude, openai`);
  }
}
