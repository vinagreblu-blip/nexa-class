# Runbook Operacional — NEXA CLASS

Guia de instalação, configuração e manutenção em produção.

## Sumário

- [🚀 Primeiro deploy em 30 minutos](#primeiro-deploy-em-30-minutos)
- [Pré-requisitos](#pré-requisitos)
- [Instalação do app desktop](#instalação-do-app-desktop)
- [Configuração crítica](#configuração-crítica)
- [Backup e restore (LGPD)](#backup-e-restore-lgpd)
- [Rotação de senhas](#rotação-de-senhas)
- [Deploy do serviço web standalone](#deploy-do-serviço-web-standalone)
- [Monitoramento](#monitoramento)
- [Troubleshooting](#troubleshooting)
- [Segurança](#segurança)

---

## Primeiro deploy em 30 minutos

Para colocar o app em produção pela primeira vez, sem ler o runbook inteiro:

### 1. Gerar o instalador (5 min)

```bash
# Em Windows, no repositório:
npm install
npm run package -w desktop
# → gera desktop/release/NEXA-CLASS-Setup.exe (~137 MB)
```

### 2. Distribuir o instalador (5 min)

- **Rede interna**: copiar `NEXA-CLASS-Setup.exe` para um share acessível aos operadores
- **Internet**: rodar `git tag v1.0.0 && git push --tags` — o CI publica no GitHub Releases e o app faz auto-update das próximas versões

### 3. Primeira execução em cada máquina (5 min)

1. Executar `NEXA-CLASS-Setup.exe`
2. Anotar as 3 secrets geradas em `%APPDATA%\NEXA CLASS\`:
   - `credenciais-iniciais.txt` — login admin (deletar após trocar senha)
   - `senha-master.txt` — senha para operações críticas (guardar em cofre)
   - `api-key.txt` — compartilhada automaticamente entre client e servidor embarcado
3. **Deletar `credenciais-iniciais.txt`** após primeiro login + troca de senha

### 4. Configurar SMTP para recuperação de senha (10 min)

Login como admin → Configurações → SMTP. Sem isso, a feature de "Esqueceu a senha?" não envia e-mails.

### 5. Validar fluxo crítico (5 min)

1. Login como admin (senha do arquivo de credenciais)
2. Trocar senha obrigatória
3. Cadastrar um aluno de teste
4. Emitir declaração para o aluno → escanear QR code com celular **na mesma rede WiFi**
5. Validar que a página pública carrega mostrando "Documento Autêntico"
6. Acessar Dashboard admin → confirmar que todos os indicadores estão verdes

> ⚠️ Para QR codes funcionarem **fora da rede local**, ver [Túnel público](#túnel-público-opcional-default-off).

### Status esperado no Dashboard após primeiro deploy

| Indicador | Estado |
|---|---|
| Cloud sync | 🟢 Ativo (Supabase auto-configurado) |
| SMTP | 🔴 Não configurado (ou 🟢 se você configurou no passo 4) |
| Sentry | 🔴 Inativo (opcional — ver [Sentry](#sentry-opcional)) |
| API key forte | 🟢 Forte (gerada automaticamente) |
| Senha master forte | 🟢 Forte (gerada automaticamente) |

---

## Pré-requisitos

- Windows 10/11 (64-bit) para o app desktop
- Node.js 20+ para o serviço web standalone (Linux/macOS OK)
- npm 9+

## Instalação do app desktop

1. Baixar o instalador `NEXA-CLASS-Setup.exe` da última release em
   https://github.com/vinagreblu-blip/nexa-class/releases
2. Executar o instalador (NSIS). Pode escolher diretório de destino.
3. No primeiro boot:
   - O app gera uma **API key forte aleatória** em
     `%APPDATA%/NEXA CLASS/api-key.txt` (32 bytes hex).
   - O app gera a **senha inicial do admin** aleatoriamente e salva em
     `%APPDATA%/NEXA CLASS/credenciais-iniciais.txt`.
   - **Anote essas credenciais e remova o arquivo de credenciais** depois de usar.

> ⚠️ A senha do admin **nunca** está nos logs. Se perder o arquivo
> `credenciais-iniciais.txt`, será necessário recriar o DB (ver [Restore](#backup-e-restore-lgpd)).

## Configuração crítica

### SMTP (recuperação de senha por e-mail)

Sem SMTP configurado, a feature de recuperação fica indisponível.

1. Login como admin → Configurações → SMTP
2. Preencher:
   - **Provedor**: ex. `smtp.gmail.com`
   - **E-mail**: conta remetente
   - **Senha**: senha de app (não a senha principal — Gmail exige)
   - **Porta**: 587 (TLS) ou 465 (SSL)
3. Testar solicitando recuperação na tela de login

### Túnel público (opcional, default OFF)

Para que QR codes funcionem **fora da rede local** (ex.: validação pela internet):
setar `NEXA_ENABLE_TUNNEL=1` no ambiente. O app criará um túnel pinggy
(`https://xxxx.pinggy.io`) e usará essa URL nos QR codes.

> ⚠️ Expor o serviço à internet aumenta a superfície de ataque. Mantenha OFF
> em redes internas isoladas. Quando ON, helmet + rate-limit protegem o endpoint.

### Sentry (opcional)

Para captura automática de erros:
- Criar projeto em https://sentry.io (ou self-hosted GlitchTip)
- Copiar DSN
- Setar `SENTRY_DSN` no ambiente antes de lançar o app

Sem DSN configurada, o Sentry fica **100% inerte** (sem enviar nada).

---

## Backup e restore (LGPD)

### Onde os dados estão

- `%APPDATA%/NEXA CLASS/nexa-class.sqlite` — DB principal (alunos, usuários,
  declarações, docentes, disciplinas)
- `%APPDATA%/NEXA CLASS/api-key.txt` — API key do serviço de verificação
- `%APPDATA%/NEXA CLASS/fotos-usuarios/` — fotos de perfil
- `%APPDATA%/NEXA CLASS/declaracoes/` — PDFs emitidos
- `%APPDATA%/NEXA CLASS/credenciais-iniciais.txt` — senha do admin inicial
  (deletar após primeiro login)

### Backup

```powershell
# Parar o app antes (para evitar concorrência com sync)
$src = "$env:APPDATA\NEXA CLASS"
$dst = "$env:USERPROFILE\Backup\nexa-$(Get-Date -Format yyyy-MM-dd).zip"
Compress-Archive -Path $src -DestinationPath $dst -Force
```

Recomendado: agendar via Agendador de Tarefas do Windows diariamente.

### Restore

```powershell
# Parar o app
Stop-Process -Name "NEXA CLASS" -ErrorAction SilentlyContinue

# Backup do estado atual (segurança)
Rename-Item "$env:APPDATA\NEXA CLASS" "$env:APPDATA\NEXA CLASS.before-restore"

# Extrair backup
Expand-Archive -Path "backup.zip" -DestinationPath "$env:APPDATA\NEXA CLASS"

# Reiniciar o app
Start-Process "C:\Program Files\NEXA CLASS\NEXA CLASS.exe"
```

### Migração para outra máquina

1. Backup completo (seção anterior)
2. Instalar o app na nova máquina (não abrir ainda)
3. Substituir `%APPDATA%/NEXA CLASS/` pelo conteúdo do backup
4. Abrir o app — deve funcionar com os dados migrados

> 💡 Cloud sync (Supabase embutido) replica os dados automaticamente. Para
> portabilidade completa, prefira o backup local.

---

## Rotação de senhas

### Senha do admin principal

1. Login como admin
2. Perfil → Alterar senha
3. Preencher senha atual + nova (mín. 6 chars)

### Senha master (exclusão de declarações, reset de usuários, etc.)

**Em produção (app empacotado):** gerada automaticamente por instalação e persistida em
`%APPDATA%/NEXA CLASS/senha-master.txt` (plaintext + hash). O admin lê a senha
nesse arquivo e a usa para operações críticas. Sem hash público no repo.

**Para rotacionar** (recomendado trimestralmente):

1. Gerar novo hash:
   ```bash
   node -e "console.log(require('bcryptjs').hashSync('nova-senha-forte', 10))"
   ```
2. Setar env `SENHA_EXCLUSAO_DECLARACAO_HASH` no ambiente antes de lançar o app:
   ```powershell
   setx SENHA_EXCLUSAO_DECLARACAO_HASH "novo-hash-gerado"
   ```
3. Reiniciar o app — a env tem precedência sobre o arquivo persistido.

> ⚠️ Não commitar o plaintext da senha. Apenas o hash (e mesmo assim, prefira
> usar a env em deploy controlado).

### Reset de senha de operador esquecida

1. Login como admin
2. Usuários → selecionar operador → "Resetar senha"
3. Informar senha master → gerada senha temporária aleatória
4. Comunicar ao operador de forma segura (presencial, preferencialmente)
5. Operador deve trocar no primeiro login (Perfil → Alterar senha)

### Recuperação auto-servida (esqueceu a senha?)

1. Tela de login → "Esqueceu a senha?"
2. Informar e-mail cadastrado
3. Receber código de 6 dígitos por e-mail (validade 30 min)
4. Digitar código + nova senha no app

> ⚠️ Após 5 tentativas incorretas, o código é invalidado — é preciso pedir
> novo. Não revelamos se o e-mail existe (mensagens genéricas).

---

## Deploy do serviço web standalone

Para uso fora da rede local sem depender do túnel pinggy, deploy do
`verificacao-web/` em VPS:

```bash
# No servidor Linux
git clone https://github.com/vinagreblu-blip/nexa-class.git
cd nexa-class/verificacao-web
npm ci
npm run build

# Configurar .env (ver .env.example)
# IMPORTANTE: API_KEY forte (não default) — em production o boot recusa default
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Rodar com systemd/pm2
NODE_ENV=production node dist/server/index.js
```

Reverse proxy nginx (HTTPS obrigatório — letsencrypt):

```nginx
server {
  listen 443 ssl http2;
  server_name verificacao.suaescola.edu.br;

  ssl_certificate /etc/letsencrypt/live/verificacao.suaescola.edu.br/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/verificacao.suaescola.edu.br/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Configurar `VERIFICACAO_BASE_URL=https://verificacao.suaescola.edu.br` e
`VERIFICACAO_API_KEY=<mesmo-valor-do-server>` no app desktop.

---

## Monitoramento

### Logs estruturados (pino JSON)

O app desktop e o serviço web emitem JSON em **stdout**. Para captura:

- **Windows (desktop)**: usar wrapper que redireciona stdout para arquivo rotacionado
  (ex.: `nssm` para serviço Windows, ou agendador com `Start-Process -RedirectStandardOutput`)
- **Linux (web standalone)**: `systemd` com `StandardOutput=journal`

Formato (produção):
```json
{"level":30,"time":1700000000000,"app":"nexa-class","env":"production","modulo":"auth","userId":42,"msg":"Login bem-sucedido"}
```

Redact LGPD: senhas, tokens, e-mails, CPFs NUNCA aparecem — substituídos por `[REDACTED]`.

### Eventos críticos logados

- **Login** sucesso/falha (com `userId`, `username`)
- **Tentativa de redefinição de senha** (com `tentativas`)
- **Token de reset bloqueado** após 5 falhas
- **API key inválida** recebida (probe suspeito) — somente no serviço web
- **Sync cloud** falhou (com tabela)
- **Auto-update** disponível/baixado/instalado
- **Erros não tratados** capturados por Sentry (se DSN configurada)

### Sentry

Opcional. Se `SENTRY_DSN` setada:
- Erros não tratados são reportados automaticamente
- LGPD: `sendDefaultPii: false` — IPs, headers e bodies de requests NÃO são enviados
- Stack traces + breadcrumbs de eventos críticos (login, sync)

---

## Troubleshooting

### App abre mas tela fica branca

- Verificar `%APPDATA%/NEXA CLASS/logs/` (se configurado) ou rodar via terminal
  para ver stdout
- Provável causa: CSP bloqueando algum asset. Verificar console do renderer
  (Ctrl+Shift+I em dev)
- Último recurso: rebuild (`npm run desktop:build`) e reinstalar

### QR Code não funciona fora da rede

- Verificar `NEXA_ENABLE_TUNNEL=1` no ambiente
- Verificar conexão SSH funciona (pinggy usa SSH): `ssh -p 443 a.pinggy.io`
- Sem túnel, QR codes só funcionam na mesma rede WiFi

### Recuperação de senha não chega

1. Verificar SMTP configurado (admin → Configurações → SMTP)
2. Verificar spam/caixa de lixo
3. Verificar e-mail cadastrado existe no sistema (admin → Usuários)
4. Verificar logs: `logger.warn({userId}, "Tentativa de login com usuário inexistente")`
5. Para Gmail: usar **senha de app** (não senha principal)

### "API key inválida" entre desktop e serviço standalone

- API key precisa ser **idêntica** nos dois lados
- Desktop: `%APPDATA%/NEXA CLASS/api-key.txt`
- Web: env `API_KEY`
- Em produção web com `NODE_ENV=production`: key default é recusada — gerar forte

### Service web standalone não inicia

- Sem `NODE_ENV=production`: qualquer key funciona (dev)
- Com `NODE_ENV=production`: recusa default/vazia/curta
- Logs em stdout explicam o motivo: `Configuração inválida — abortando boot`

### Sync cloud não replica

- Verificar conectividade internet
- Verificar logs: `logger.warn({err}, "Erro no sync bidirecional")`
- Supabase tem RLS habilitado (ver `supabase-migration-rls.sql`) —
  políticas podem bloquear operações. Verificar no painel Supabase

---

## Segurança

### Boas práticas operacionais

- **Rotacionar** SENHA_EXCLUSAO_DECLARACAO_HASH trimestralmente
- **Remover** `credenciais-iniciais.txt` após primeiro login admin
- **Backup** diário dos dados em local seguro (criptografado)
- **Limitar** acesso físico ao PC do admin (sessão fica em memória após login)
- **Auditar** logs de login semanais: usuários inexistentes + senhas incorretas
  indicam tentativas de força bruta
- **Atualizar** o app quando houver nova release (auto-update baixa
  automaticamente; instala ao fechar)

### Vulnerabilidades conhecidas e mitigações

| Risco | Mitigação |
|---|---|
| DB local vazado | Senhas com bcrypt (cost 10). Hash do código de reset com bcrypt. |
| Ataque de força bruta no serviço web | Rate-limit 100 req/min + helmet headers |
| Enumeração de códigos de QR | Rate-limit + códigos são UUID (128 bits entropia) |
| E-mail interceptado | Código de reset expira em 30 min, lockout após 5 tentativas |
| Logo spoofing no e-mail | Mensagens não incluem links clicáveis (só código digitado no app) |
| XSSI/XSS no serviço web | `escapeHtml` em todos os outputs + CSP sem unsafe-inline para scripts |
| LGPD: dados pessoais em logs | Pino redact: e-mail, cpf, senha, token nunca aparecem (substituídos por `[REDACTED]`) |
| LGPD: PII no Sentry | `sendDefaultPii: false` — IP/headers/bodies não coletados |

### Contato para incidentes

Em caso de comprometimento suspeito:
1. Desconectar PC da rede
2. Fazer backup imediato (para análise forense)
3. Rotacionar TODAS as senhas (admin + master + usuários)
4. Verificar logs dos últimos 30 dias em busca de anomalias
5. Notificar usuários cujas declarações foram emitidas no período suspeito
