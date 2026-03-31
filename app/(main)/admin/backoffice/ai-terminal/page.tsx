import AITerminal from '@/components/backoffice/AITerminal';

export const metadata = { title: 'AI Terminal — Suno Goals' };

export default function AITerminalPage() {
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold text-neutral-10">AI Terminal</h1>
        <p className="text-sm text-neutral-5 mt-0.5">
          Converse com os dados de indicadores e books da Suno
        </p>
      </div>
      <AITerminal />
    </div>
  );
}
