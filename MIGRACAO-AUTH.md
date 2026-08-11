# Migração de Segurança — Auth por Instalação

Fecha a brecha onde a `anon key` (pública, embutida no `.exe`) sozinha permitia
ler todos os dados dos alunos via Supabase. A partir de agora, **toda tabela
operacional exige a role `authenticated`** — ou seja, um JWT obtido via Supabase
Auth. Cada instalação do desktop cria sua própria identidade no primeiro run
(e-mail/senha aleatórios salvos em `userData/cloud-auth.json`) e usa o JWT para
sincronizar.

## Ordem de execução (IMPORTANTE — não inverter)

As máquinas em uso estão com a v1.0.0, que sincroniza **sem auth**. Se você
aplicar o RLS novo antes de todos atualizarem, eles perdem o sync. Siga nesta
ordem:

### 1. Desativar confirmação por e-mail no Supabase
As identidades são de máquina, com e-mails fake `@nexa-class.local` — confirmação
por email não faz sentido e bloquearia o `signUp` automático.

- Acesse https://supabase.com/dashboard/project/evapmgnwznybylbtjmco/auth/providers
- Abra o provider **Email**
- Desmarque **"Confirm email"**
- Save

### 2. Publicar a v1.1.0 (com o novo código de auth)
O `.exe` novo contém o fluxo de identidade por instalação. As máquinas em uso
auto-atualizam ao fechar o app.

```bash
# bump de versão em package.json (raiz) e desktop/package.json → 1.1.0
git tag v1.1.0
git push origin v1.1.0
# o workflow release.yml builda e publica no GitHub Releases
```

### 3. Aguardar propagação (1 a 3 dias)
Deixe as máquinas abertas/fechando para o auto-update pegar a v1.1.0. Cada uma
cria sua identidade Supabase Auth no primeiro run e aparece em
**Dashboard → Máquinas com acesso à nuvem**.

> Acompanhe pelo Dashboard: o número de máquinas listadas deve crescer até
> estabilizar. Rode o SQL do passo 4 **só depois** de confirmar que todas as
> máquinas ativas já apareceram lá (ou seja, já estão na v1.1.0 autenticada).

### 4. Aplicar a migration RLS (fecha a brecha)
Cole no SQL Editor do Supabase e rode:

```
supabase-rls-auth.sql
```

A partir desse momento:
- A `anon key` sozinha **não consegue mais ler nada** das tabelas operacionais.
- Qualquer máquina que ainda esteja na v1.0.0 para de sincronizar (desejado).
- Para testar: pegue só a `anon key` e tente `GET` em
  `https://evapmgnwznybylbtjmco.supabase.co/rest/v1/alunos?select=*&apikey=<anon>`
  → deve retornar erro 401/403 ou array vazio.

## Rotacionar a anon key (opcional, recomendado)

A anon key atual está exposta no `.exe` v1.0.0 que circulou. Embora ela não dê
mais acesso a dados (depois do passo 4), rotacionar remove qualquer dúvida:

- https://supabase.com/dashboard/project/evapmgnwznybylbtjmco/settings/api
- "JWT Settings" → **Generate new JWT** (afeta só a anon key)
- Atualize a constante `SUPABASE_KEY` em `desktop/electron/cloud.ts` e publique
  a v1.2.0 para todos.

## Revogar uma máquina

Dois níveis:

- **Soft (pelo Dashboard do app):** botão "Revogar" no painel Máquinas → seta
  `revoked=1` → o app dessa máquina para de sincronizar e mostra aviso. O
  usuário pode reabrir o app normalmente, mas sem sync.
- **Hard (pelo Supabase):** delete o usuário em
  https://supabase.com/dashboard/project/evapmgnwznybylbtjmco/auth/users →
  `signIn` falha definitivamente → sem acesso à nuvem. Use quando uma máquina
  foi roubada/descontinuada.

## Notas técnicas

- **Identidade persistida em `userData/cloud-auth.json`** (modo 0600). Se o
  arquivo for apagado, a instalação cria uma nova identidade (a antiga vira
  órfã — limpe pelo painel Auth do Supabase periodicamente).
- **Sessões:** `persistSession: false` + `autoRefreshToken: true`. A cada boot
  o app refaz `signInWithPassword` (tem as creds salvas); o token em memória é
  renovado automaticamente pelo SDK.
- **Boot offline:** se a rede cair, o app abre normalmente em modo offline
  (SQLite local) e reautentica no próximo ciclo de sync (15s).
- **Ameaças que isto NÃO resolve:** um atacante com acesso físico à máquina
  pode extrair o `cloud-auth.json` e usar a identidade dela. Para esse caso,
  o caminho é revogação hard (deletar o usuário no Supabase) — o que invalida
  o `cloud-auth.json` roubado.
