import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMStreamOptions } from '../types';

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';

  async *streamChat(options: LLMStreamOptions): AsyncIterable<string> {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const stream = client.messages.stream({
      model: process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: options.systemPrompt,
      messages: [
        ...options.history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: options.userMessage },
      ],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}
