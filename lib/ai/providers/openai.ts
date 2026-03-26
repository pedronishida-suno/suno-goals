import OpenAI from 'openai';
import type { LLMProvider, LLMStreamOptions } from '../types';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';

  async *streamChat(options: LLMStreamOptions): AsyncIterable<string> {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const stream = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: options.systemPrompt },
        ...options.history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: options.userMessage },
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
