import { getIndicators } from '@/lib/services/indicators';
import { getIndicatorData } from '@/lib/services/indicatorData';
import { getBooks } from '@/lib/services/books';

const TOKEN_BUDGET = 12_000; // ~3000 tokens at 4 chars/token

const MONTH_NAMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

/**
 * Builds a plain-text context block to inject into the system prompt.
 * Strategy (RAG-lite, no vector DB):
 * 1. Always: top-20 indicator catalog
 * 2. Focused: if message mentions an indicator/book, fetch its monthly data
 * 3. Monday live: if message contains 'monday', fetch catalog from Monday.com
 */
export async function buildContext(params: {
  message: string;
  contextHint?: string;
  userId?: string;
}): Promise<string> {
  const { message, contextHint } = params;
  const year = new Date().getFullYear();
  const parts: string[] = [];

  // 1. Indicator catalog
  try {
    const indicators = await getIndicators({});
    const catalog = indicators.slice(0, 20).map(ind =>
      `[${ind.id.slice(0, 8)}] ${ind.name} | ${ind.format} | ${ind.direction} | ${ind.status}${ind.tags?.length ? ` | tags: ${ind.tags.map(t => t.name).join(', ')}` : ''}`
    ).join('\n');
    parts.push(`=== CATÁLOGO DE INDICADORES (${Math.min(indicators.length, 20)} de ${indicators.length}) ===\n${catalog}`);
  } catch {
    parts.push('=== CATÁLOGO DE INDICADORES ===\n(erro ao carregar)');
  }

  // 2. Focused data — indicator hint
  if (contextHint?.startsWith('indicator:')) {
    const indicatorId = contextHint.slice('indicator:'.length);
    try {
      const monthlyData = await getIndicatorData(indicatorId, year);
      if (monthlyData.length > 0) {
        const rows = monthlyData.map(d =>
          `${MONTH_NAMES[d.month - 1]}/${year}: meta=${d.meta}, real=${d.real}, alcance=${d.percentage.toFixed(1)}%`
        ).join('\n');
        parts.push(`=== DADOS DO INDICADOR (${year}) ===\n${rows}`);
      }
    } catch { /* skip */ }
  }

  // 3. Focused data — book hint
  if (contextHint?.startsWith('book:')) {
    const bookId = contextHint.slice('book:'.length);
    try {
      const books = await getBooks({});
      const book = books.find(b => b.id === bookId);
      if (book) {
        const summary = `Book: ${book.name}\nDono: ${book.owner?.name ?? '—'}\nAno: ${book.year}\nIndicadores: ${book.indicators?.length ?? 0}`;
        parts.push(`=== BOOK SELECIONADO ===\n${summary}`);
      }
    } catch { /* skip */ }
  }

  // 4. Keyword-based: find relevant indicators mentioned in the message
  const msgLower = message.toLowerCase();
  const liveHint = ['monday', 'ao vivo', 'realtime', 'real-time', 'agora'].some(k => msgLower.includes(k));
  if (liveHint) {
    parts.push('=== NOTA ===\nDados do Monday.com são a fonte primária. Use o botão "Sync Monday" para atualizar os dados no sistema antes de analisar.');
  }

  // 5. Recent books summary (always include a brief one)
  try {
    const books = await getBooks({});
    const recent = books.slice(0, 5).map(b =>
      `${b.name} | ${b.owner?.name ?? '—'} | ${b.year} | ${b.indicators?.length ?? 0} indicadores`
    ).join('\n');
    if (recent) parts.push(`=== BOOKS RECENTES ===\n${recent}`);
  } catch { /* skip */ }

  // Assemble and enforce token budget
  const full = parts.join('\n\n');
  if (full.length <= TOKEN_BUDGET) return full;

  // Truncate: trim last part until it fits
  let result = '';
  for (const part of parts) {
    if ((result + '\n\n' + part).length > TOKEN_BUDGET) break;
    result = result ? result + '\n\n' + part : part;
  }
  return result + '\n\n[contexto truncado por limite de tokens]';
}
