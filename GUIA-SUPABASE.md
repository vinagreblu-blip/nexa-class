# 📗 Guia Completo: Criar Projeto Supabase para o NEXA CLASS

## Passo 1 — Criar conta no Supabase

1. Abra o navegador e acesse: **https://supabase.com**
2. Clique no botão verde **"Start your project"** no canto superior direito
3. Você tem 3 opções de login:
   - **"Continue with GitHub"** (recomendado — você já tem conta no GitHub)
   - **"Continue with Google"**
   - **Email e senha** (criar conta nova)
4. Escolha uma opção e faça login
5. Após o login, você verá o painel do Supabase (Dashboard)

---

## Passo 2 — Criar um novo projeto

1. No painel, clique no botão verde **"New Project"** (ou "New project" se for a primeira vez)

2. Preencha os campos:
   - **Organization:** deixe a padrão (ou crie uma nova com seu nome)
   - **Name:** digite `nexa-class` (é o nome do projeto)
   - **Database Password:** 
     - Clique em **"Generate a password"** (gera uma senha forte automaticamente)
     - **COPIE E SALVE essa senha** em um bloco de notas (vai precisar depois)
   - **Region:** clique no menu e escolha **"South America (São Paulo)"** (mais perto do Brasil = mais rápido)
   - **Pricing Plan:** deixe em **"Free"** (gratuito, até 500MB de dados)

3. Clique no botão verde **"Create new project"** no final da página

4. **AGUARDE 2 a 3 minutos** — aparece uma tela de carregamento "Setting up your project"
   - Não feche a página
   - Vai aparecer "Project is ready" quando terminar

---

## Passo 3 — Criar as tabelas do banco de dados

1. No painel do Supabase (após o projeto estar pronto), olhe o **menu lateral esquerdo**

2. Clique em **"SQL Editor"** (ícone de código `</>`)

3. Clique no botão **"New query"** (canto superior direito)

4. Vai aparecer uma caixa de texto vazia no centro

5. Abra o arquivo no seu computador:
   ```
   C:\dev\pessoal\universidade-app\supabase-schema.sql
   ```
   (Abra com o Bloco de Notes)

6. **Selecione TODO o texto** (Ctrl+A) e **Copie** (Ctrl+C)

7. **Cole** (Ctrl+V) todo o conteúdo na caixa de texto do Supabase

8. Clique no botão verde **"Run"** no canto inferior direito

9. Vai aparecer uma mensagem verde no rodapé: **"Success. No rows returned"**
   (Isso significa que as tabelas foram criadas com sucesso!)

---

## Passo 4 — Pegar a URL e a Key do projeto

1. No **menu lateral esquerdo**, clique em **"Settings"** (ícone de engrenagem ⚙️ — geralmente o último item)

2. No submenu, clique em **"API"**

3. Na tela que aparece, procure por duas informações:

   ### 4.1 — Project URL
   - Procure a seção **"Project URL"**
   - Copie o link que aparece (algo como):
     ```
     https://abcdefghij.supabase.co
     ```
   - Cole no Bloco de Notes para não perder

   ### 4.2 — anon public key
   - Role um pouco para baixo até a seção **"Project API keys"**
   - Procure a linha **"anon"** com a coluna **"public"**
   - Clique em **"Reveal"** (olhinho 👁️) para mostrar a chave
   - É uma chave MUITO longa começando com `eyJ...`
   - **Copie** essa chave inteira
   - Cole no Bloco de Notes também

---

## Passo 5 — Configurar no NEXA CLASS

1. Abra o sistema **NEXA CLASS** no seu computador

2. Faça login: `admin` / `admin123`

3. No **menu lateral esquerdo**, clique em **"Nuvem"** (perto do final)

4. Preencha os campos:
   - **Supabase URL:** cole a URL que você copiou no Passo 4.1
     (exemplo: `https://abcdefghij.supabase.co`)
   - **Supabase Anon Key:** cole a chave que você copiou no Passo 4.2
     (a chave longa começando com `eyJ...`)
   - **Ativar sincronização:** marque a caixinha ✓

5. Clique no botão **"Salvar Configuração"**

6. Deve aparecer a mensagem verde: **"Nuvem ativada!"**

7. Clique em **"Sincronizar Agora"** para enviar seus dados atuais para a nuvem

---

## Passo 6 — Configurar nos outros computadores

Em cada computador que você quiser que compartilhe os dados:

1. Instale o NEXA CLASS (usando o `NEXA CLASS Setup 1.0.0.exe`)
2. Abra o sistema → faça login como admin
3. Vá em **"Nuvem"**
4. Cole a **MESMA URL** e a **MESMA Key** do Passo 4
5. Ative e salve
6. Clique em **"Sincronizar Agorar"**
7. **Pronto!** Vai ver todos os alunos, docentes e disciplulas do outro computador

---

## Como testar se funcionou

1. No **Computador A**: cadastre um novo aluno (ex: "Teste Nuvem")
2. No **Computador B**: abra o NEXA CLASS → vá em **Alunos**
3. Clique em **"Sincronizar Agora"** na aba Nuvem (ou reinicie o app)
4. O aluno "Teste Nuvem" deve aparecer na lista!

---

## Resumo visual

```
https://supabase.com
  → Login (GitHub/Google/Email)
  → New Project: nexa-class (Free, São Paulo)
  → SQL Editor → Cole supabase-schema.sql → Run
  → Settings → API → Copie URL + anon key
  → NEXA CLASS → aba Nuvem → Cole URL + Key → Ativar → Salvar
  → Sincronizar Agora
  → Pronto! Todos compartilham dados!
```

---

## Limites do plano grátis (Free)
- **500 MB** de banco de dados (suficiente para ~50.000 alunos)
- **1 GB** de armazenamento de arquivos
- **2 GB** de tráfego por mês
- **Sem custo** — é grátis para sempre (até atingir os limites)

Se precisar de mais, o plano Pro custa $25/mês com 8GB de banco.
