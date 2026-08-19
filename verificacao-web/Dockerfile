# Dockerfile do serviço web de verificação NEXA CLASS.
#
# Deploy em qualquer host que suporte Docker (Render, Railway, Fly.io, VPS).
# O serviço sobe na porta definida por PORT (default 3001) e responde:
#   - GET  /health                → health check
#   - POST /api/declaracoes       → registra declaração (requer x-api-key)
#   - GET  /api/declaracoes/:cod  → busca declaração
#   - GET  /v/:codigo             → página pública (o que aparece no QR Code)
#
# Variáveis obrigatórias em produção (ver .env.example):
#   - API_KEY (forte, 32+ chars — não pode ser o default público)
#   - NODE_ENV=production
# Variáveis opcionais:
#   - PORT (default 3001)
#   - SENTRY_DSN
#   - INSTITUICAO

# ---------- build stage ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Copia apenas manifests para cache eficiente de npm ci.
COPY package.json package-lock.json* ./
COPY verificacao-web/package*.json ./verificacao-web/

# Instala deps do workspace web (incluindo devDeps para o build do TS).
RUN npm ci --workspace verificacao-web --include-workspace-root || npm install --workspace verificacao-web

# Copia código do serviço web.
COPY verificacao-web/ ./verificacao-web/

# Compila TypeScript → dist/
RUN npm run -w verificacao-web build

# ---------- runtime stage ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Instala apenas deps de produção.
COPY package.json package-lock.json* ./
COPY verificacao-web/package*.json ./verificacao-web/
RUN npm ci --workspace verificacao-web --omit=dev --include-workspace-root || npm install --workspace verificacao-web --omit=dev

# Copia build compilado.
COPY --from=builder /app/verificacao-web/dist ./verificacao-web/dist
COPY --from=builder /app/verificacao-web/public ./verificacao-web/public

# Melhor-sqlite3 precisa do toolchain nativo no runtime.
# Pre-built binaries cobrem linux x64/arm64 no Node 20.
ENV NODE_ENV=production
ENV PORT=3001

# Volume persiste o SQLite entre deploys (não obrigatório — DB pode ser efêmero,
# já que o app desktop re-envia declarações a cada emissão).
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3001

# Healthcheck para orquestradores (Render, Railway, k8s).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3001)+'/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

WORKDIR /app/verificacao-web
CMD ["node", "dist/server/index.js"]
