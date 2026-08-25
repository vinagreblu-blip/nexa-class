# NEXA CLASS — Network for Education and Academic Excellence Class

Sistema desktop para gestão acadêmica com:

1. Cadastro de alunos (CRUD)
2. Edição de informações
3. Exclusão de registros
4. Usuários com login/senha (bcrypt + sessão, roles `admin`/`operador`)
5. Geração de QR Code nos documentos
6. Emissão de PDF da Declaração de Autenticidade

## Estrutura

```
universidade-app/
├── desktop/          # App Electron (React + Vite + TypeScript + SQLite)
└── verificacao-web/  # Serviço web público que valida o QR Code
```

## Pré-requisitos

- Node.js 18+
- npm 9+

## Instalação

```bash
npm install
```

## Desenvolvimento

Em dois terminais:

```bash
# 1) Serviço web de verificação (porta 3001)
npm run web:dev

# 2) App desktop
npm run desktop:dev
```

## Configuração

### Desktop

`desktop/electron/config.ts` define:
- `VERIFICACAO_BASE_URL`: URL pública do serviço de verificação (entra no QR Code)
- `VERIFICACAO_API_KEY`: API key enviada ao serviço web ao registrar declaração.
  - Em **desenvolvimento** (app não empacotado): se não setada, usa o default público `'nexa-dev-api-key-trocar'`.
  - Em **produção** (app empacotado): se não setada, **gera automaticamente** uma key forte (32 bytes) e a persiste em `userData/api-key.txt`. Não há ação do operador.
  - Para deploy com o serviço standalone `verificacao-web/`: sete `VERIFICACAO_API_KEY` no desktop = `API_KEY` no serviço web.
- `ADMIN_SEED`: credenciais do admin inicial criado no primeiro run

> Altere a senha do admin após o primeiro login.

### Serviço web

`verificacao-web/.env` (copie de `.env.example`):
- `PORT` porta (default 3001)
- `API_KEY` deve bater com `VERIFICACAO_API_KEY` do desktop.
  - Em `NODE_ENV=production` o serviço **recusa iniciar** se a key for o default, vazia ou curta (< 16 chars).
  - Gere uma com: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `DB_PATH` caminho do SQLite
- `NODE_ENV` define o modo (`development` aceita default; `production` exige key forte)

### Hardening ativo

O serviço web aplica por padrão:
- **`helmet`** — headers HTTP seguros (CSP, X-Content-Type-Options, X-Frame-Options, etc.). A CSP permite `'unsafe-inline'` para styles porque a página `/v/:codigo` renderiza `<style>` inline (sem scripts inline; todo input é escapado).
- **`express-rate-limit`** — 100 req/min por IP em todas as rotas exceto `/health`. Mensagem de erro JSON consistente (`{ ok: false, error: "Muitas requisições. Tente novamente em instantes." }`). Headers padrão `RateLimit-*` (sem legacy `X-RateLimit-*`).

Para ajustar limites em deploy com carga maior (ex.: validação em massa de diplomas em formatura), edite `RATE_LIMIT_DEFAULT_MAX` / `RATE_LIMIT_DEFAULT_JANELA_MS` em `server/app.ts`.

## Multiusuário em tempo real (5 usuários, mesma base)

O app desktop é **offline-first**: cada máquina tem seu SQLite local (`userData/nexa-class.sqlite`) e sincroniza com o **Supabase (PostgreSQL)** — o banco central e fonte oficial dos dados. O login de cada usuário (admin/operador, bcrypt) vem da tabela `usuarios`, que também sincroniza: os 5 usuários veem os mesmos alunos/docentes/disciplinas/declarações.

Fluxo de uma mudança:

```
Usuário edita no app
→ SQLite local (na hora, com updated_at em ms)
→ push acelerado (~2,5s) ao Supabase
→ Supabase Realtime (WebSocket) entrega INSERT/UPDATE/DELETE a todas as máquinas
→ cada máquina aplica no SQLite local e notifica a tela (sem F5)
```

Componentes:
- `desktop/electron/sync-core.ts` — núcleo puro: aplicação de linhas remotas (last-write-wins por `updated_at` em ms), tombstones de exclusão (`delecoes`), push incremental por watermark.
- `desktop/electron/cloud.ts` — sync bidirecional (pull/push, ciclo de 15s como rede de segurança) + push acelerado pós-mutação.
- `desktop/electron/realtime.ts` — assinatura `postgres_changes` (12 tabelas × INSERT/UPDATE/DELETE), reconexão com backoff e re-sync completo ao voltar.
- `desktop/src/utils/useSyncTempoReal.ts` — hook que recarrega as listas quando outra máquina altera dados.
- Indicador de conexão (dot verde/vermelho no rodapé da sidebar) + toasts de queda/reconexão.

Concorrência: last-write-wins por `updated_at` (ms); duplicatas evitadas por chaves únicas (matrícula, username, código de verificação); exclusões propagam via tombstones com retenção de 90 dias e **não ressuscitam** (push stale de máquina dessincronizada é bloqueado pelo tombstone local).

### Habilitar o Realtime no Supabase (1x, obrigatório)

Cole e rode `supabase-realtime.sql` no **SQL Editor** do projeto (após schema + migrations RLS existentes). Sem isso o app funciona, mas sem atualização instantânea (só o ciclo de 15s).

### Testar 5 usuários simultâneos

1. Rode o `supabase-realtime.sql` no Supabase (uma vez).
2. Instale/abra o app em 2+ máquinas (ou 2 instâncias: `npm -w desktop run dev`).
3. Máquina A: cadastre "Aluno João" → deve aparecer em B em segundos, sem F5.
4. Máquina B: edite o nome → A vê a edição.
5. Máquina B: cadastre "Aluno Maria" → A vê.
6. Máquina A: exclua "Aluno Maria" → some em B.
7. Derrube a rede de B (desligue o Wi-Fi): o dot fica vermelho; edite em A; religue a rede de B → reconecta e recebe a edição sozinho.

### Cuidados de deploy pelo GitHub

- **Sempre rode o SQL novo no Supabase ANTES de publicar a versão do app que depende dele.**
- Nova versão `.exe` → tag no git → workflow publica no GitHub Releases → as máquinas auto-atualizam ao fechar o app. Teste em 1 máquina antes de taggear.
- **Nunca commite** `.env`, `cloud-auth.json`, senhas ou service_role key (o `.gitignore` já cobre `.env`; a anon key embutida no binário é pública por design — a proteção é o RLS `authenticated`).

## Build

```bash
npm run desktop:build   # gera instalador em desktop/release
npm run web:build       # compila serviço web
```
