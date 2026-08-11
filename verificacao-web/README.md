# Serviço Web NEXA CLASS — QR Codes Públicos

Serviço Express que valida QR codes de declarações/diplomas de **qualquer celular do mundo**.

## 🚀 Deploy RÁPIDO (Cloudflare Tunnel — grátis, sem cartão)

Na máquina que vai hospedar o serviço (1 das 6, preferencialmente a do admin):

```powershell
# 1. Instalar cloudflared (1 vez só):
winget install --id Cloudflare.cloudflared --silent --accept-package-agreements --accept-source-agreements

# 2. Sempre que precisar subir o serviço (após reboot, etc):
.\iniciar-servico-web.ps1
```

O script mostra a URL pública (algo como `https://silence-manhattan-represented-reynolds.trycloudflare.com`).

## ⚠️ Limitação do Cloudflare Quick Tunnel

A URL `.trycloudflare.com` **muda toda vez que o túnel reinicia**. Para URL estável e definitiva:

**Opção A — Render.com free (~5 min setup manual)**:
1. https://render.com → Sign up com GitHub
2. New + → Blueprint → selecionar repo `vinagreblu-blip/nexa-class`
3. Configure `API_KEY`, `NODE_ENV=production`
4. Deploy → URL fixa `https://nexa-verificacao.onrender.com`
5. (Contras: free tier dorme após 15 min sem tráfego)

**Opção B — Fly.io (~$2/mês, URL fixa)**:
```bash
flyctl apps create nexa-verificacao --org personal
flyctl secrets set API_KEY=... NODE_ENV=production INSTITUICAO=...
flyctl deploy
```
(Exige cartão, mas valor real ~$2/mês para uso leve)

**Opção C — VPS Linux + nginx + letsencrypt** (ver `DEPLOY-MULTI-MAQUINA.md`)

## 📋 Configurar as 6 máquinas

Em **cada** máquina Windows, abra PowerShell como Administrador:

```powershell
# Substitua pelos valores corretos
setx VERIFICACAO_API_KEY "SUA-API-KEY-GERADA" /M
setx VERIFICACAO_BASE_URL "https://silence-manhattan-represented-reynolds.trycloudflare.com" /M
setx SENHA_EXCLUSAO_DECLARACAO_HASH "HASH-GERADO" /M

# Reiniciar o PC
```

API key gerada com:
```bash
node scripts/gerar-deploy-keys.js
```

Senha master gerada com:
```bash
node scripts/gerar-senha-master.js
```

## 🔍 Endpoints

| Método | Path | Descrição |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/api/declaracoes` | Registra declaração (header `x-api-key`) |
| GET | `/api/declaracoes/:codigo` | Busca declaração (JSON) |
| DELETE | `/api/declaracoes/:codigo` | Remove declaração (header `x-api-key`) |
| GET | `/v/:codigo` | **Página pública HTML** — o que aparece no QR Code |

## 🛡️ Segurança

- **Helmet**: headers HTTP seguros + CSP
- **Rate-limit**: 100 req/min por IP em rotas `/api/*`
- **bcrypt/timingSafeEqual** no compare da API key
- **Redact LGPD**: e-mail/cpf/senha nunca entram nos logs
- **LGPD-friendly Sentry** opcional (setar `SENTRY_DSN`)

## 📊 Status

- 51 testes unitários cobrindo todos endpoints
- Dockerfile pronto para deploy em qualquer host
- `render.yaml` blueprint para Render.com
- `fly.toml` config para Fly.io
