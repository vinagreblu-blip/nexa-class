# Deploy NEXA CLASS — 6 máquinas em redes WiFi diferentes

Guia passo a passo para configurar o sistema em **6 máquinas Windows** que **não compartilham rede WiFi**, com **QR codes funcionando em qualquer celular** e **mesma senha master** em todas.

---

## 🎯 Arquitetura final

```
                    ┌─────────────────────────────┐
                    │  Serviço Web Público        │
                    │  (Render/Railway/VPS)       │
                    │  https://nexa-...onrender.com│
                    └──────────────┬──────────────┘
                                   │
                          (QR codes apontam aqui)
                                   │
            ┌──────────┬───────────┼───────────┬──────────┐
            │          │           │           │          │
       ┌────┴───┐ ┌────┴───┐ ┌────┴───┐ ┌────┴───┐ ┌────┴───┐
       │Máquina1│ │Máquina2│ │Máquina3│ │Máquina4│ │Máquina5│ ...
       │ WiFi A │ │ WiFi A │ │ WiFi B │ │ WiFi C │ │ WiFi D│
       └────┬───┴ └────┬───┴ └────┬───┴ └────┬───┴ └────┬───┘
            │          │           │           │          │
            └──────────┴─────┬─────┴───────────┴──────────┘
                             │
                    ┌────────▼────────┐
                    │  Supabase       │
                    │  (Cloud sync)   │
                    └─────────────────┘
```

**Cada máquina:** instala o app, tem seu DB local, sincroniza via Supabase.
**QR codes:** apontam para o serviço web público (não para IP local).
**Senha master:** mesma em todas as 6 máquinas (via env var).

---

## 📋 Pré-requisitos

- [ ] GitHub account (já tem — repo `vinagreblu-blip/nexa-class`)
- [ ] Conta no [Render.com](https://render.com) (free tier) OU [Railway](https://railway.app) OU VPS Linux
- [ ] 6 instalações Windows 10/11 (4 GB RAM cada)
- [ ] Acesso de admin às 6 máquinas para setar variáveis de ambiente

---

## 🚀 Etapa 1 — Deploy do serviço web público (1 vez, ~30 min)

### Opção A — Render.com (mais simples, free tier)

1. **Criar conta** em https://render.com com seu GitHub
2. **New +** → **Blueprint**
3. **Selecionar** o repo `vinagreblu-blip/nexa-class`
4. Render detecta `verificacao-web/render.yaml` automaticamente
5. **Configurar variáveis de ambiente** (Dashboard → Environment):
   - `API_KEY` — gerar com:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
     Copie o valor (64 chars hex) — vai ser usado também nas 6 máquinas.
   - `NODE_ENV=production`
   - `INSTITUICAO=NEXA CLASS - Network for Education and Academic Excellence Class`
6. **Apply** → Render faz build e deploy (~3 min)
7. **Anotar URL pública** gerada: `https://nexa-verificacao.onrender.com`
8. **Testar:** abrir no navegador:
   ```
   https://nexa-verificacao.onrender.com/health
   ```
   Deve retornar `{"ok":true,"servico":"verificacao-web","instituicao":"..."}`

### Opção B — Railway.app

1. Criar conta em https://railway.app
2. **New Project** → **Deploy from GitHub repo**
3. Selecionar `vinagreblu-blip/nexa-class`
4. **Settings**:
   - Root Directory: `verificacao-web`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
5. **Variables**: same as Render (`API_KEY`, `NODE_ENV=production`, etc.)
6. **Settings → Networking → Generate Domain**
7. Anotar URL: `https://nexa-verificacao.up.railway.app`

### Opção C — VPS Linux (Hetzner/DigitalOcean)

```bash
# Na VPS (Ubuntu 22+):
git clone https://github.com/vinagreblu-blip/nexa-class.git
cd nexa-class/verificacao-web
npm ci
npm run build

# Configurar .env (copiar de .env.example e preencher)
cp .env.example .env
nano .env  # preencher API_KEY, NODE_ENV=production

# Rodar com pm2 (recomendado — auto-restart)
npm i -g pm2
pm2 start "node dist/server/index.js" --name nexa-verificacao
pm2 save
pm2 startup

# Nginx + Letsencrypt (HTTPS obrigatório)
sudo apt install nginx certbot python3-certbot-nginx
# configurar server block + proxy_pass http://127.0.0.1:3001
sudo certbot --nginx -d verificacao.suaescola.edu.br
```

---

## 🔑 Etapa 2 — Gerar senha master única (1 vez, 5 min)

```bash
# No repo local (Windows):
cd C:\dev\pessoal\universidade-app
node scripts\gerar-senha-master.js
```

O script vai:
1. Pedir a senha master (mín. 10 chars) — **anote em cofre físico/digital**
2. Gerar o hash bcrypt
3. Mostrar o comando `setx` pronto para colar nas máquinas

**Exemplo de output:**
```
Senha master: MinhaSenh@Forte2026
Hash: $2a$10$abcdef...

Comando para cada máquina:
  setx SENHA_EXCLUSAO_DECLARACAO_HASH "$2a$10$abcdef..."
```

---

## 💻 Etapa 3 — Configurar cada máquina Windows (5 min por máquina)

Repetir para cada uma das 6 máquinas:

### 3.1 Baixar e instalar o app
1. Baixar `NEXA-CLASS-Setup.exe` da release
2. Duplo-clique → avançar no wizard NSIS
3. Avisos do SmartScreen → "Mais informações" → "Executar mesmo assim"

### 3.2 Configurar variáveis de ambiente (1 vez por máquina)

Abrir **PowerShell como Administrador** e rodar:

```powershell
# API key — IGUAL à do serviço web (Etapa 1)
setx VERIFICACAO_API_KEY "valor-da-api-key-do-servico-web" /M

# URL pública do serviço web — IGUAL em todas
setx VERIFICACAO_BASE_URL "https://nexa-verificacao.onrender.com" /M

# Senha master hash — IGUAL em todas (Etapa 2)
setx SENHA_EXCLUSAO_DECLARACAO_HASH "$2a$10$hash-gerado" /M

# (Opcional) Sentry
setx SENTRY_DSN "https://...@sentry.io/123" /M
```

**Reiniciar o PC** para as variáveis serem lidas pelo app na próxima execução.

### 3.3 Primeira execução
1. Abrir o app (Menu Iniciar → NEXA CLASS)
2. **Anotar as secrets** em `%APPDATA%\NEXA CLASS\`:
   - `credenciais-iniciais.txt` — login admin desta máquina (deletar após)
   - `senha-master.txt` — **IGNORAR** — já configuramos nossa própria via env
   - `api-key.txt` — **IGNORAR** — já configuramos via env
3. Login admin + trocar senha obrigatória
4. **Deletar** `credenciais-iniciais.txt` (não precisamos mais)
5. **Configurar SMTP** (Configurações → SMTP) — só na primeira máquina, depois sincroniza via Supabase

### 3.4 Validar
1. Cadastrar um aluno de teste
2. Emitir declaração para o aluno
3. Escanear o QR code com o **celular no 4G** (não WiFi da máquina)
4. ⚠️ **Confirmar**: a página carregou? → QR está funcionando fora da rede local
5. Acessar Dashboard → confirmar:
   - 🟢 Cloud sync
   - 🟢 API key forte
   - 🟢 Senha master forte
   - 🔴 Sentry inativo (se não configurou) — pode ignorar

---

## 🌐 Etapa 4 — Testar sincronização entre máquinas (~5 min)

1. **Máquina A**: cadastrar aluno "Teste João"
2. **Máquina B**: aguardar 15 segundos → ir em Alunos → "Teste João" deve aparecer
3. **Máquina A**: emitir declaração para "Teste João"
4. **Máquina B**: aguardar 15s → ir em Documentos Institucionais → Declarações → declaração deve aparecer
5. **Celular (4G)**: escanear QR Code do PDF gerado em A → página "Documento Autêntico" carrega

Se tudo passou ✅ deploy completo.

---

## 📊 Resumo da configuração

| Item | Valor | Mesmo em todas? |
|---|---|---|
| `API_KEY` (serviço web) | 64 chars hex forte | ✅ |
| `VERIFICACAO_API_KEY` (cada máquina) | = `API_KEY` do serviço | ✅ |
| `VERIFICACAO_BASE_URL` (cada máquina) | `https://nexa-verificacao.onrender.com` | ✅ |
| `SENHA_EXCLUSAO_DECLARACAO_HASH` (cada máquina) | Hash bcrypt da senha master | ✅ |
| `ADMIN_PASSWORD` (primeiro login) | Aleatório por máquina | ❌ Cada uma tem a sua |
| Senha do admin (após troca) | Definida pelo operador | ❌ Cada operador pode ter a sua |
| DB SQLite local | `%APPDATA%\NEXA CLASS\nexa-class.sqlite` | ❌ Independente (sync via Supabase) |

---

## ⚠️ Pontos de atenção

### Free tier Render "adormece"
Após 15 min sem tráfego, free tier do Render desliga. Primeiro request demora ~30s para re-acordar.

**Solução barata** (US$ 7/mês): Render Starter Plan, nunca dorme.
**Solução free**: ping periódico:
```bash
# Cron-job.org ou similar — pinga a cada 10 min
curl https://nexa-verificacao.onrender.com/health
```

### Backup do DB Supabase
Cloud sync é automático, mas **não é backup**. Recomendado:
1. Acessar Supabase Dashboard
2. Database → Backups → configurar backup diário
3. OU dump SQL mensal via `pg_dump` (Supabase fornece)

### Limitação de concorrência
Edições simultâneas no **mesmo** aluno em 2 máquinas podem conflitar (sync bidirecional usa `updated_at` mas não tem resolução de merge). Prática recomendada: cada operador cuida de uma turma/curso para evitar sobreposição.

---

## 🔧 Troubleshooting

### QR code não carrega no celular
1. Confirmar URL no PDF — deve começar com `https://nexa-verificacao.onrender.com/v/...`
2. Acessar `https://nexa-verificacao.onrender.com/health` no navegador do celular
3. Se 404: deploy falhou — checar logs no Render/Railway
4. Se `ERR_CONNECTION_REFUSED`: free tier dormindo — aguardar 30s e tentar de novo

### Sync cloud não replica entre máquinas
1. Dashboard → Cloud sync deve estar 🟢
2. Logs do app: `logger.warn({err}, "Erro no sync bidirecional")`
3. Painel Supabase → verificar se tabela tem dados
4. RLS pode estar bloqueando — checar `supabase-migration-rls.sql` aplicado

### Senha master não funciona em alguma máquina
1. Verificar env: `echo %SENHA_EXCLUSAO_DECLARACAO_HASH%` no cmd
2. Se vazio: variável não foi setada — repetir `setx ... /M` como admin
3. **Reiniciar o PC** (env vars só recarregam após reboot ou novo login)
4. Hash deve ser idêntico em todas as máquinas

### API key inválida entre desktop e serviço web
1. Comparar caractere por caractere: `VERIFICACAO_API_KEY` no desktop vs `API_KEY` no Render
2. Tamanho deve ser o mesmo (64 chars hex)
3. Sem espaços extras nem quebras de linha

---

## 📦 Próximos passos após deploy

1. **Versionar:** `git tag v1.0.1 && git push --tags` — gera release no GitHub
2. **Backup inicial:** dump do Supabase após cadastrar todos os alunos
3. **Treinar operadores:** cada um anota sua própria senha de login (não a master)
4. **Monitorar:** Dashboard → logs → se habilitou Sentry, checar painel semanalmente
