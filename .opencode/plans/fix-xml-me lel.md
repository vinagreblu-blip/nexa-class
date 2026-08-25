# Plano: corrigir geração de XML que falha silenciosamente (máquina melel)

## Diagnóstico confirmado

- Mensagem relatada ("arquivo não encontrado, talvez tenha sido movido, editado ou excluído") **não é do app** — é do Word/Windows ao abrir arquivo inexistente. O XML nunca foi gravado no disco.
- Na v1.2.13 (instalada), `fs.writeFileSync` sem try/catch nos 3 fluxos de XML → exceção propaga, `ipcRenderer.invoke` rejeita, UI não captura → **nenhum erro na tela, spinner trava**; usuário só descobre ao abrir o arquivo depois.
- `requerAuth` (desktop/electron/ipc/auth.ts:16) também não captura exceções.
- Fluxos afetados na melel: **Histórico → Gerar XML** (save dialog → pasta possivelmente bloqueada por OneDrive/Defender) e **Documentos do aluno → Converter** (grava em AppData ao lado do PDF).

## Já aplicado no working tree (turno anterior, não commitado)

- `desktop/electron/utils/sistema.ts` — novo `gravarArquivoSeguro()`: grava no destino; se bloqueado, salva em fallback (`%APPDATA%\NEXA CLASS\xml` ou pasta de documentos do aluno) retornando `aviso`; se ambos falharem, retorna erro descritivo.
- `desktop/electron/ipc/diploma.ts` (`gerarXmlDiploma`), `historico.ts` (`gerarXmlHistorico`), `documentos.ts` (`converterXml`) — usam o helper + `logger.warn`; retorno inclui `aviso?`.
- `desktop/electron/preload.ts`, `desktop/src/api.ts` — tipos atualizados (`{ xmlPath: string; aviso?: string }`).
- UI exibe `aviso` com caminho do fallback: `Diploma.tsx`, `Historicos.tsx`, `DocumentosAluno.tsx`.
- `desktop/electron/utils/sistema.test.ts` — 4 testes novos de `gravarArquivoSeguro` (sucesso, fallback, nome fallback, falha dupla).

## Passos restantes (executar após sair do modo plano)

1. **Try/catch na UI** (3 funções) para qualquer rejeição IPC virar erro visível e destravar spinner:
   - `desktop/src/pages/Diploma.tsx` — `gerarXml(d, senhaPfx)`
   - `desktop/src/pages/Historicos.tsx` — `gerarXml(senhaPfx)`
   - `desktop/src/components/DocumentosAluno.tsx` — `converter(id)`
   - Padrão:
     ```tsx
     try {
       const res = await api...;
       if (res.ok && res.data) { setSucesso(res.data.aviso ?? `...${res.data.xmlPath}`); }
       else if (res.error !== 'Operação cancelada') { setErro(res.error ?? '...'); }
     } catch (e: any) {
       setErro(e?.message ?? 'Erro ao gerar XML');
     } finally {
       setSpinner(false);
     }
     ```
2. **Version bump** `1.2.13 → 1.2.14` em `desktop/package.json` **e** `package.json` (raiz) — convenção do commit `3f12d55`.
3. **Validação**: `npm run typecheck` e `npm test` em `desktop/` (CI também roda `desktop:typecheck` na raiz).
4. **Commits** (estilo do repo):
   - `fix(xml): gravacao de xml com fallback e erro visivel ao usuario` — 10 arquivos já modificados + 3 da UI.
   - `chore(release): v1.2.14` — só os 2 package.json.
5. **Tag + push**: `git tag v1.2.14 && git push --tags` → workflow `.github/workflows/release.yml` builda o instalador e publica no GitHub Releases com `latest.yml` → `electron-updater` (main.ts:191) instala automaticamente na melel ao reiniciar o app (autoDownload + autoInstallOnAppQuit). Sem download manual.

## Workaround imediato na melel (sem nova versão)

- Histórico → Gerar XML: no diálogo de salvar, escolher pasta local fora do OneDrive (ex.: `C:\temp`).
- Segurança do Windows → Proteção contra ransomware → permitir o app NEXA CLASS (ou verificar bloqueios em "Histórico de proteção").
- Documentos do aluno → Converter: verificar em `%APPDATA%\NEXA CLASS\documentos\<aluno_id>\` se há .pdf/.xml; antivírus pode estar removendo os arquivos (ver Histórico de proteção do Defender).
