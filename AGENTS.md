# Agent Roles — Suno Goals

Multi-agent architecture for developing and running the platform.
Each role has a defined scope, tool access, and escalation path.

---

## 1. Orchestrator (Claude Code — Sonnet 4.6)

**Purpose:** System architect and primary dev agent. Coordinates all other agents.

**Owns:**
- Next.js codebase (`app/`, `lib/`, `components/`)
- Supabase schema migrations
- Monday.com API integration (`lib/services/monday.ts`, `app/api/monday/`)
- Snowflake sidecar (Python, `sidecar/`)
- CI/CD and `.env` management

**Can do:**
- Read/write all project files
- Run shell commands (build, test, migrate)
- Spawn sub-agents for parallel work
- Query Monday.com GraphQL directly via `MONDAY_API_TOKEN`

**Escalate to user when:**
- Schema-breaking migrations
- Destructive ops (drop table, force push)
- Snowflake credentials needed

---

## 2. AI Terminal (Runtime — `lib/ai/`)

**Purpose:** In-app assistant for FP&A analysts in the backoffice terminal.

**Entry point:** `app/admin/backoffice/ai-terminal/page.tsx` → `app/api/ai/chat/`

**Provider switching** (`LLM_PROVIDER` env var):

| Value | Model | Use case |
|-------|-------|----------|
| `ollama` | `openclaw` (default) | Local, offline, no cost |
| `claude` | claude-sonnet-4-6 | Higher quality, production |
| `openai` | gpt-4o | Fallback |

**Context strategy** (`lib/ai/context-builder.ts`):
- Always injects: indicator catalog (top 20), recent books
- On `indicator:<id>` hint: injects 12-month data for that indicator
- On `book:<id>` hint: injects book summary
- Token budget: 12 000 chars (~3 000 tokens), truncates oldest parts first

**Current limitations:**
- Read-only — cannot write to Supabase or Monday
- No vector DB — RAG is keyword-based
- Monday live data only on demand (no streaming)

**Scale-up path:**
- Add vector embeddings (pgvector on Supabase) for semantic search
- Add tool-calling so agent can trigger Monday sync itself
- Route heavy analysis to `claude` provider, quick Q&A to `ollama`

---

## 3. Monday Sync Agent (API route)

**Purpose:** Keeps Supabase in sync with Monday.com as the source of truth.

**Boards:**
- `3896178865` — Indicadores e Metas (indicator catalog + monthly data)

**Column mappings:**

| Monday column | Supabase field | Notes |
|---|---|---|
| item name | `name` (parsed) | Format: `Tipo: (dim; dim; ...)` |
| `text2` | `name` (friendly) | Full indicator name |
| `text7` | `key` | Backup key |
| `text23` | `description` | |
| `color91` | `status` | Ativo → active, Inativo → inactive |
| `color0` | `direction` | Cima → up, Baixo → down |
| `color2` | `format` | % → percentage, R$ → currency, # → number |
| `color8` | `aggregation_type` | Soma → sum, Média → average |

**Routes:**
- `POST /api/monday/sync` — full indicator catalog sync
- `POST /api/monday/sync-data` — monthly actuals sync

**Scale-up path:**
- Webhook from Monday on item change → incremental sync
- Snowflake as secondary source for actuals (when credentials available)

---

## 4. Snowflake Agent (Sidecar — Python)

**Purpose:** Query Snowflake for historical actuals and feed `indicator_data`.

**Status:** Infrastructure ready, credentials pending.

**Setup needed:**
```env
SNOWFLAKE_ACCOUNT=<account>
SNOWFLAKE_USER=<user>
SNOWFLAKE_PASSWORD=<password>
SNOWFLAKE_WAREHOUSE=<warehouse>
SNOWFLAKE_DATABASE=<database>
SNOWFLAKE_SCHEMA=<schema>
```

**Scale-up path:**
- Once credentials provided: map Snowflake views → `indicator_data` upsert
- Schedule nightly sync via cron route

---

## 5. Development Sub-agents (Ollama — `openclaw`)

**Purpose:** Code-assistance tasks that don't require full Claude context.

**Model:** `ollama run openclaw` (local, fast, no API cost)

**Delegate to openclaw when:**
- Generating boilerplate (new service, new API route)
- Writing SQL migrations
- Transforming data shapes (Monday response → Supabase row)
- Drafting unit tests for pure functions

**Keep in Claude Code when:**
- Architectural decisions
- Multi-file refactors
- Security-sensitive changes
- Anything requiring codebase-wide context

**How to invoke from Claude Code:**
```bash
curl http://localhost:11434/api/generate \
  -d '{"model":"openclaw","prompt":"<task>","stream":false}'
```
Or via `LLM_PROVIDER=ollama` in the AI Terminal.

---

## 6. Data Roles (Non-agent)

These are human roles that agents serve:

| Role | What they need from agents |
|------|---------------------------|
| FP&A Analyst | AI Terminal for indicator analysis |
| Book Owner | Book wizard, performance dashboard |
| Backoffice Admin | Sync controls, user/indicator CRUD |
| Developer | This file + CLAUDE.md for onboarding |

---

## Scaling Checklist

- [ ] Monday webhook → remove polling, enable real-time sync
- [ ] pgvector on Supabase → semantic indicator search in AI Terminal
- [ ] Tool-calling in AI Terminal → agent can self-serve data queries
- [ ] Snowflake credentials → activate sidecar for historical actuals
- [ ] Separate `openclaw` tasks from orchestrator → reduce Claude API cost
- [ ] Add `claude-opus-4-6` route for complex multi-indicator analysis
