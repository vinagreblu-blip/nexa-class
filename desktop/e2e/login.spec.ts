import { test, expect } from '@playwright/test';
import {
  launchApp,
  cleanup,
  preencherLogin,
  loginEDescartarTroca,
  ADMIN_USERNAME,
} from './helpers';

test.describe('Fluxo de login', () => {
  test('login com credenciais corretas redireciona para tela de troca obrigatória', async () => {
    const handle = await launchApp();
    try {
      const window = await preencherLogin(handle, ADMIN_USERNAME, handle.senhaAdminInicial);

      // Como o admin seed vem com senha_temporaria=1, espera-se a tela de troca
      // obrigatória — não o Layout principal.
      await expect(window.getByText('Troca de senha obrigatória')).toBeVisible({
        timeout: 15_000,
      });
      await expect(window.getByText(/defina uma nova senha antes de continuar/i)).toBeVisible();
    } finally {
      await cleanup(handle);
    }
  });

  test('login com senha incorreta mostra erro e NÃO redireciona', async () => {
    const handle = await launchApp();
    try {
      const window = await preencherLogin(handle, ADMIN_USERNAME, 'senha-errada-mesmo');

      await expect(window.getByText('Usuário ou senha inválidos')).toBeVisible({
        timeout: 10_000,
      });

      // Continua na tela de login.
      await expect(window.locator('input[type="text"]')).toBeVisible();

      // NÃO deve ter menu lateral.
      await expect(window.getByRole('button', { name: 'Alunos' })).toHaveCount(0);
    } finally {
      await cleanup(handle);
    }
  });

  test('login com usuário inexistente mostra mesmo erro (não revela existência)', async () => {
    const handle = await launchApp();
    try {
      const window = await preencherLogin(handle, 'usuario-falso-xyz', 'qualquer-coisa');

      // Mesma mensagem — proteção contra enumeração de usuários.
      await expect(window.getByText('Usuário ou senha inválidos')).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await cleanup(handle);
    }
  });

  test('campos obrigatórios: botão Entrar desabilitado sem input', async () => {
    const handle = await launchApp();
    try {
      const window = await handle.electronApp.firstWindow();
      const botao = window.getByRole('button', { name: /^Entrar$/ });

      await expect(botao).toBeDisabled();

      await window.locator('input[type="text"]').fill('admin');
      await expect(botao).toBeDisabled();

      await window.locator('input[type="text"]').fill('');
      await window.locator('input[type="password"]').fill('x');
      await expect(botao).toBeDisabled();

      await window.locator('input[type="text"]').fill('admin');
      await expect(botao).toBeEnabled();
    } finally {
      await cleanup(handle);
    }
  });
});

test.describe('Pós-login (após troca obrigatória de senha)', () => {
  test('menu lateral mostra itens esperados para admin', async () => {
    const handle = await launchApp();
    try {
      const window = await loginEDescartarTroca(handle);

      const itensEsperados = [
        'Home',
        'Alunos',
        'Docentes',
        'Disciplinas',
        'Histórico Acadêmico',
        'Diploma',
        'Cursos',
        'Assinatura Digital',
        'Converter arquivos',
        'Usuários',
        'Perfil',
      ];

      for (const item of itensEsperados) {
        await expect(window.getByRole('button', { name: item })).toBeVisible();
      }
    } finally {
      await cleanup(handle);
    }
  });

  test('navegação: clicar em Alunos muda o conteúdo principal', async () => {
    const handle = await launchApp();
    try {
      const window = await loginEDescartarTroca(handle);
      await window.getByRole('button', { name: 'Alunos' }).click();

      // Página de alunos tem um input de busca ou botão "Novo aluno".
      // Como o DB é fresh, provavelmente mostra "Nenhum aluno" — aceitamos
      // qualquer um desses indicadores.
      const indicador =
        window.getByPlaceholder(/buscar/i).or(window.getByRole('button', { name: /novo aluno/i }));
      await expect(indicador.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup(handle);
    }
  });

  test('navegação: clicar em Usuários mostra lista com admin', async () => {
    const handle = await launchApp();
    try {
      const window = await loginEDescartarTroca(handle);
      await window.getByRole('button', { name: 'Usuários' }).click();

      // DB fresh → único usuário é o admin ("Administrador").
      await expect(window.getByText(/Administrador/i).first()).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await cleanup(handle);
    }
  });

  test('navegação: Dashboard (admin only) mostra contadores e status do sistema', async () => {
    const handle = await launchApp();
    try {
      const window = await loginEDescartarTroca(handle);
      await window.getByRole('button', { name: 'Dashboard' }).click();

      // Título da página visível
      await expect(window.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
        timeout: 10_000,
      });

      // Cards de contadores — labels únicos do dashboard (não aparecem no menu lateral)
      await expect(window.getByText('Declarações', { exact: true }).last()).toBeVisible();
      await expect(window.getByText('Diplomas', { exact: true }).last()).toBeVisible();
      await expect(window.getByText('Usuários ativos', { exact: true })).toBeVisible();

      // Painel de status do sistema visível.
      await expect(window.getByText('Status do sistema', { exact: true })).toBeVisible();
      await expect(window.getByText(/Cloud sync/i)).toBeVisible();
      await expect(window.getByText(/Versão do app/i)).toBeVisible();
    } finally {
      await cleanup(handle);
    }
  });
});
