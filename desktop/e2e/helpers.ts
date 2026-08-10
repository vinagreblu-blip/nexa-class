import type { ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * Helpers para testes E2E do app Electron.
 *
 * Estratégia:
 *  - userData isolado em tmp por teste (DB fresh, sem estado de runs anteriores)
 *  - NEXA_USERDATA aponta Electron para esse dir via app.setPath() no main.ts
 *  - Após lançar, lê a senha real do arquivo credenciais-iniciais.txt gerado
 *    pelo seed — mais robusto que depender da env ADMIN_PASSWORD chegar ao Electron
 *  - NEXA_E2E=1 força carregar do build dist/ (sem precisar de Vite dev)
 */

export const ADMIN_USERNAME = 'admin';
export const NOVA_SENHA_POS_TROCA = 'nova-senha-forte-456';

export interface AppHandle {
  electronApp: ElectronApplication;
  tmpUserData: string;
  /** Senha real do admin, lida do arquivo após o seed rodar. */
  senhaAdminInicial: string;
}

/**
 * Espera o arquivo de credenciais aparecer no userData (sinal de que o seed
 * terminou). Lê e devolve a senha. Timeout: 30s.
 */
async function lerSenhaInicial(tmpUserData: string): Promise<string> {
  const credsPath = path.join(tmpUserData, 'credenciais-iniciais.txt');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(credsPath)) {
      const conteudo = fs.readFileSync(credsPath, 'utf8');
      // Linha: "Senha: <senha>"
      const match = conteudo.match(/^Senha:\s*(.+)$/m);
      if (match) return match[1].trim();
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Tempo esgotado esperando credenciais-iniciais.txt em ${credsPath}. ` +
      `Seed do admin pode ter falhado — checar logs do Electron.`
  );
}

export async function launchApp(): Promise<AppHandle> {
  const tmpUserData = path.join(
    os.tmpdir(),
    `nexa-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(tmpUserData, { recursive: true });

  const electronApp = await electron.launch({
    args: [
      path.join(__dirname, '..'),
      // --user-data-dir é respeitado pelo Chromium ANTES de qualquer JS rodar,
      // ao contrário de app.setPath que pode chegar tarde demais. Único jeito
      // confiável de isolar DB/estado entre testes E2E.
      `--user-data-dir=${tmpUserData}`,
    ],
    env: {
      ...process.env,
      NEXA_E2E: '1',
      NODE_ENV: 'development',
    },
    cwd: path.join(__dirname, '..'),
  });

  // Sanity check silencioso: se userData não bate com o tmp, o teste seguinte
  // (lerSenhaInicial) vai falhar com timeout — melhor falhar cedo com msg clara.
  const realUserData = await electronApp.evaluate(async ({ app }) => app.getPath('userData'));
  if (realUserData !== tmpUserData) {
    await electronApp.close();
    throw new Error(
      `user-data-dir não respeitado. Esperado: ${tmpUserData}. Real: ${realUserData}.`
    );
  }

  // Espera o seed terminar para descobrir a senha real.
  const senhaAdminInicial = await lerSenhaInicial(tmpUserData);

  return { electronApp, tmpUserData, senhaAdminInicial };
}

export async function cleanup(handle: AppHandle): Promise<void> {
  await handle.electronApp.close();
  try {
    fs.rmSync(handle.tmpUserData, { recursive: true, force: true });
  } catch {
    /* ignora */
  }
}

/**
 * Preenche usuário/senha e clica em Entrar.
 */
export async function preencherLogin(
  handle: AppHandle,
  usuario: string,
  senha: string
): Promise<Page> {
  const window = await handle.electronApp.firstWindow();
  await window.locator('input[type="text"]').fill(usuario);
  await window.locator('input[type="password"]').fill(senha);
  await window.getByRole('button', { name: /^Entrar$/ }).click();
  return window;
}

/**
 * Fluxo completo: login admin + troca obrigatória de senha → Layout visível.
 * Usa a senha real do arquivo (handle.senhaAdminInicial) para login e troca.
 */
export async function loginEDescartarTroca(handle: AppHandle): Promise<Page> {
  const window = await preencherLogin(handle, ADMIN_USERNAME, handle.senhaAdminInicial);

  // Aguarda tela de troca obrigatória aparecer.
  await window.getByText('Troca de senha obrigatória').waitFor({ timeout: 15_000 });

  // 3 campos password: atual, nova, confirmar.
  const inputs = window.locator('input[type="password"]');
  await inputs.nth(0).fill(handle.senhaAdminInicial);
  await inputs.nth(1).fill(NOVA_SENHA_POS_TROCA);
  await inputs.nth(2).fill(NOVA_SENHA_POS_TROCA);

  await window.getByRole('button', { name: /trocar senha e continuar/i }).click();

  // Aguarda menu lateral (Layout).
  await window.getByRole('button', { name: 'Alunos' }).waitFor({ timeout: 15_000 });
  return window;
}
