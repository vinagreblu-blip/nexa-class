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
- `VERIFICACAO_API_KEY`: API key enviada ao serviço web ao registrar declaração
- `ADMIN_SEED`: credenciais do admin inicial criado no primeiro run

> Altere a senha do admin após o primeiro login.

### Serviço web

`verificacao-web/.env` (copie de `.env.example`):
- `PORT` porta (default 3001)
- `API_KEY` deve bater com `VERIFICACAO_API_KEY` do desktop
- `DB_PATH` caminho do SQLite

## Build

```bash
npm run desktop:build   # gera instalador em desktop/release
npm run web:build       # compila serviço web
```
