# Suno Goals — Terminal de Controle de Indicadores

Sistema interno da Suno para gestão do Book de Indicadores por colaborador, time e setor.

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS 4**
- **Supabase** — PostgreSQL + Auth + RLS
- **Snowflake** — Data warehouse de origem (via sidecar Python)
- **Ollama / Claude API** — Terminal IA (Fase 4)

## Estrutura de Fases

| Fase | Escopo | Status |
|---|---|---|
| 1 — MVP | Books de Tecnologia, Supabase real, sync Snowflake | Em desenvolvimento |
| 2 — Dashboards | Analytics para liderança, módulo PDCA | Planejado |
| 3 — Escala | Todos os setores da Suno | Planejado |
| 4 — IA | Terminal conversacional (ollama:openclaw / Claude) | Planejado |

## Setup

### 1. Dependências

```bash
npm install
```

### 2. Variáveis de Ambiente

Crie `.env.local` na raiz (ver `ENV_EXAMPLE.md` para todas as variáveis):

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
```

### 3. Supabase — Setup do banco

1. Crie um projeto em [supabase.com](https://supabase.com) (região: `sa-east-1`)
2. No **SQL Editor**, execute em ordem:
   ```
   supabase/schema.sql
   supabase/indicators_module.sql
   supabase/migrations/001_phase1.sql
   ```

### 4. Criar primeiro admin

No **SQL Editor** do Supabase:

```sql
-- 1. Crie o usuário em Authentication > Users (Auto Confirm User = ON)
-- 2. Copie o UUID gerado e substitua abaixo:

INSERT INTO public.users (id, email, full_name, role, status)
VALUES (
  'UUID-DO-AUTH-USER-AQUI',
  'seu-email@suno.com.br',
  'Seu Nome',
  'admin',
  'active'
);
```

### 5. Rodar localmente

```bash
npm run dev
# http://localhost:3000
```

## Sidecar Snowflake (Fase 1)

```bash
cd snowflake-sidecar
pip install -r requirements.txt
cp .env.example .env   # preencher credenciais Snowflake
python main.py
# Rodando em http://localhost:8001
```

Configurar mapeamentos em `snowflake-sidecar/mapping.json` antes de usar.

## Terminal IA (Fase 4)

Configurar `LLM_PROVIDER` no `.env.local`:
- `ollama` → modelo local gratuito (`OLLAMA_MODEL=openclaw`)
- `claude` → Claude API (`ANTHROPIC_API_KEY=sk-ant-...`)

## Design System

- **Suno Red**: `#D42126` | **Suno Gray**: `#4B4B4B`
- **Inter** (texto) + **Montserrat** (display/títulos)

## Licença

Uso interno — Suno © 2026
