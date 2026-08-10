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

## Build

```bash
npm run desktop:build   # gera instalador em desktop/release
npm run web:build       # compila serviço web
```
