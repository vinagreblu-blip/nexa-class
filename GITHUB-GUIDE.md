# 📦 Como publicar o NEXA CLASS no GitHub e usar profissionalmente

## Passo 1 — Criar o repositório principal

1. Acesse **github.com** e faça login
2. Clique em **"+" → "New repository"**
3. Preencha:
   - **Repository name:** `nexa-class`
   - **Description:** `NEXA CLASS — Sistema Acadêmico (Electron + React + SQLite)`
   - **Private** (recomendado para uso empresarial) ou **Public**
   - **NÃO** marque "Add a README" nem ".gitignore"
4. Clique em **"Create repository"**

---

## Passo 2 — Enviar o código pelo terminal

Abra o **Prompt de Comando (CMD)** e execute os comandos abaixo, **um por um**:

```cmd
cd /d C:\dev\pessoal\universidade-app

git init

git add .

git commit -m "NEXA CLASS - Sistema Acadêmico completo"

git branch -M main

git remote add origin https://github.com/vinagreblu-blip/nexa-class.git

git push -u origin main
```

> Se pedir usuário/senha, use seu login do GitHub. Se pedir token, crie um em: GitHub → Settings → Developer settings → Personal access tokens → Generate new token (marque "repo")

---

## Passo 3 — Subir o validador.html (para QR Code funcionar)

### No GitHub, crie um SEGUNDO repositório:
1. **"+" → "New repository"**
2. **Repository name:** `nexa-validador`
3. **Public** (tem que ser público para o GitHub Pages)
4. **Create repository**

### Suba o arquivo:
1. Clique em **"uploading an existing file"**
2. **Arraste** o arquivo: `C:\dev\pessoal\universidade-app\desktop\resources\validador.html`
3. No campo nome, troque para **`index.html`** (importante!)
4. **Commit changes**

### Ative o GitHub Pages:
1. **Settings → Pages**
2. Source: **"Deploy from a branch"** → Branch: **`main`** → **`/(root)`**
3. **Save**
4. Aguarde 3 minutos
5. Sua URL será: **`https://vinagreblu-blip.github.io/nexa-validador/`**

---

## Passo 4 — Testar o QR Code

1. Gere um histórico ou declaração no sistema
2. Escaneie o QR Code com o celular
3. Deve aparecer ✅ "Documento Autêntico" com os dados

---

## Passo 5 — Usar profissionalmente na empresa

### Para instalar em outros computadores:

```cmd
git clone https://github.com/vinagreblu-blip/nexa-class.git
cd nexa-class
npm install
```

### Para gerar o instalador (.exe):

```cmd
cd nexa-class
npm -w desktop run build
npm -w desktop run package
```

O instalador `.exe` será gerado em `desktop/release/`.

---

## Estrutura do projeto no GitHub

```
nexa-class/
├── desktop/              # App desktop (Electron)
│   ├── electron/         # Código principal (banco, IPC, PDF)
│   ├── src/              # Interface (React)
│   ├── resources/        # Logos e assets
│   └── package.json
├── verificacao-web/      # Serviço web de verificação QR
├── package.json          # Workspace raiz
└── README.md
```
