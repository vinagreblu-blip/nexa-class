// Sentry DEVE ser o primeiro import para que hooks globais de erro capturem
// quaisquer exceções lançadas durante o boot dos módulos abaixo.
import { initSentryDesktop } from './sentry';
initSentryDesktop({ dsn: process.env.SENTRY_DSN });

import { app, BrowserWindow, Menu, session, shell, Notification } from 'electron';
import path from 'node:path';

// Override de userData para testes E2E. Em produção esta env fica unset.
// Nota: --user-data-dir é passed como launch arg no helper de testes
// (mais confiável que app.setPath que pode rodar tarde demais).
const userDataOverride = process.env.NEXA_USERDATA;
if (userDataOverride && !app.isReady()) {
  try {
    app.setPath('userData', userDataOverride);
  } catch {
    /* Path pode já ter sido lido; --user-data-dir via launch arg é o fallback. */
  }
}

import { autoUpdater } from 'electron-updater';
import { initDatabase } from './database';
import { registrarAuthHandlers } from './ipc/auth';
import { registrarAlunosHandlers } from './ipc/alunos';
import { registrarUsuariosHandlers } from './ipc/usuarios';
import { registrarDeclaracaoHandlers, reenviarDeclaracoesSemArquivoNuvem } from './ipc/declaracao';
import { registrarDiplomaHandlers, reenviarDiplomasPendentesWeb } from './ipc/diploma';
import { registrarAtaColacaoHandlers } from './ipc/ata-colacao';
import { registrarCursosLivresHandlers } from './ipc/cursos-livres';
import { registrarDiplomasDigitaisHandlers } from './ipc/diplomas-digitais';
import { registrarCertificadosHandlers } from './ipc/certificados';
import { registrarHistoricoHandlers } from './ipc/historico';
import { registrarDocentesHandlers } from './ipc/docentes';
import { registrarDisciplinasHandlers } from './ipc/disciplinas';
import { registrarDocumentosHandlers } from './ipc/documentos';
import { registrarRecuperacaoHandlers } from './ipc/recuperacao';
import { registrarDashboardHandlers } from './ipc/dashboard';
import { registrarSmtpHandlers } from './ipc/smtp';
import { registrarExtracaoHandlers } from './ipc/extracao';
import { registrarConversoesHandlers } from './ipc/conversoes';
import { registrarAssinaturaHandlers } from './ipc/assinatura';
import { registrarTsaHandlers } from './ipc/tsa';
import { registrarPoliticaHandlers } from './ipc/politica';
import { registrarCloudHandlers } from './ipc/cloud';
import { initCloud, syncBidirecional, agendarSyncRapido, setOnDadosAlterados } from './cloud';
import { iniciarRealtime, fecharRealtime, setOnEstadoConexao, obterEstadoConexao } from './realtime';
import { setLocalWriteListener, shutdown as dbShutdown } from './sqlite-adapter';
import { getDb } from './database';
import { IPC_CHANNELS } from './types';
import { iniciarServicoVerificacao } from './servico-verificacao';
import { iniciarTunnel, fecharTunnel } from './tunnel';
import { CONFIG } from './config';
import { logger } from './utils/logger';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
// Em modo E2E (testes Playwright), carrega do build local mesmo em "dev"
// para não depender do Vite dev server rodando.
const isE2E = process.env.NEXA_E2E === '1';

let mainWindow: BrowserWindow | null = null;

/**
 * Content Security Policy — bloqueia XSS, inline scripts não autorizados, conexões
 * a hosts arbitrários. Em dev, libera ws/eval/blob para HMR do Vite.
 *
 * Notas:
 *  - Em produção o app carrega de file://, então 'self' sozinho não cobre os assets
 *    locais — adicionamos `file:` explicitamente.
 *  - Em dev o Vite serve de http://localhost:5173 com HMR via ws:// e precisa de
 *    unsafe-inline/eval para o React Refresh + source maps.
 */
function aplicarCsp(): void {
  const csp = isDev
    ? [
        "default-src 'self' http://localhost:5174 blob: data:",
        // unsafe-inline/eval para React Refresh; http://localhost:5174 para scripts servidos pelo Vite
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5174 blob:",
        "style-src 'self' 'unsafe-inline' blob:",
        // HMR + Supabase + túnel; blob: para alguns assets do Vite
        "connect-src 'self' http://localhost:5174 ws://localhost:5174 https://*.supabase.co wss://*.supabase.co https://*.pinggy.io blob:",
        "img-src 'self' data: blob: http://localhost:5174",
        "font-src 'self' data: blob:",
        "worker-src 'self' blob:", // pdfjs e tesseract podem usar workers via blob
      ].join('; ')
    : [
        // Produção: file:// carrega os assets locais. 'self' + file: cobrem.
        "default-src 'self' file: data:",
        "script-src 'self' file:",
        "style-src 'self' 'unsafe-inline' file:",
        // Supabase (sync) + túnel pinggy (quando habilitado via NEXA_ENABLE_TUNNEL)
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.pinggy.io",
        "img-src 'self' data: file: blob:",
        "font-src 'self' data: file:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
      ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

function criarJanela(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: CONFIG.APP_NAME,
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox precisa ficar false: o preload requer o módulo local './types'
      // (IPC_CHANNELS). Em sandbox o require de módulos locais é proibido e o
      // preload quebra antes de expor window.api, deixando o login travado.
      // contextIsolation + nodeIntegration:false já isolam a página do preload.
      sandbox: false,
    },
  });

  // Bloqueia popups/links externos abrindo no Electron — abre no navegador do SO.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => { /* ignora */ });
    return { action: 'deny' };
  });

  // Bloqueia navegação para fora do app (phishing via iframe interno etc.).
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const allowedOrigins = ['http://localhost:5174', 'file://'];
    if (!allowedOrigins.some((o) => url.startsWith(o))) {
      e.preventDefault();
    }
  });

  // Recuperação de tela branca: se o processo do renderer travar/crashar (GPU,
  // OOM, erro fatal), recarrega a janela em vez de deixar uma tela em branco.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error({ reason: details?.reason }, 'render-process-gone: recarregando janela');
    try { mainWindow?.webContents.reload(); } catch { /* ignora */ }
  });

  if (isDev && !isE2E) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Estado inicial de conexão para janelas recém-criadas (o evento só é
  // emitido em transições — na criação da janela o renderer precisa do valor
  // atual para desenhar o indicador corretamente).
  mainWindow.webContents.once('did-finish-load', () => {
    try {
      mainWindow?.webContents.send(IPC_CHANNELS.CONEXAO_ESTADO, obterEstadoConexao());
    } catch { /* ignora */ }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registrarHandlers(): void {
  registrarAuthHandlers();
  registrarAlunosHandlers();
  registrarUsuariosHandlers();
  registrarDeclaracaoHandlers();
  registrarDiplomaHandlers();
  registrarAtaColacaoHandlers();
  registrarCursosLivresHandlers();
  registrarCertificadosHandlers();
  registrarHistoricoHandlers();
  registrarDocentesHandlers();
  registrarDisciplinasHandlers();
  registrarDocumentosHandlers();
  registrarRecuperacaoHandlers();
  registrarDashboardHandlers();
  registrarSmtpHandlers();
  registrarExtracaoHandlers();
  registrarConversoesHandlers();
  registrarAssinaturaHandlers();
  registrarTsaHandlers();
  registrarPoliticaHandlers();
  registrarCloudHandlers();
  registrarDiplomasDigitaisHandlers();
  try {
    iniciarServicoVerificacao();
  } catch (e: any) {
    logger.warn({ err: e }, 'Serviço de verificação não iniciado');
  }
  try {
    iniciarTunnel();
  } catch (e: any) {
    logger.warn({ err: e }, 'Túnel não iniciado');
  }
}

/**
 * Auto-update via GitHub Releases (electron-updater). Só roda em produção.
 * Baixa a nova versão em background e instala ao fechar o app; notifica o
 * usuário quando o download termina. Repo público → não exige token.
 */
function configurarAutoUpdate(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    logger.info({ version: info.version }, 'Nova versão disponível (baixando)');
  });
  autoUpdater.on('update-not-available', () => {
    logger.debug('App atualizado');
  });
  autoUpdater.on('update-downloaded', (info) => {
    logger.info({ version: info.version }, 'Atualização baixada — instala ao fechar');
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Atualização do NEXA CLASS',
          body: `Versão ${info.version} baixada. Ela será instalada ao fechar o aplicativo.`,
        }).show();
      }
    } catch { /* ignora */ }
  });
  autoUpdater.on('error', (e) => {
    logger.warn({ err: e }, 'Erro no auto-update');
  });

  autoUpdater.checkForUpdatesAndNotify().catch((e: any) => {
    logger.warn({ err: e }, 'Falha ao checar atualizações');
  });
  // Re-checa a cada 4h enquanto o app estiver aberto.
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

app.whenReady().then(async () => {
  // Aplica CSP antes de criar qualquer janela
  aplicarCsp();

  try {
    // Conecta à nuvem primeiro (cria identidade por instalação + signIn).
    // Não bloqueia o boot por mais de alguns segundos; falhas de rede seguem
    // offline e o sync periódico tenta autenticar novamente.
    await initCloud();

    // Inicializa banco de dados local
    await initDatabase();

    // Força resolução da senha master no boot — garante que o arquivo
    // senha-master.txt esteja presente desde o primeiro boot, ao lado das
    // credenciais-iniciais.txt e api-key.txt (todas as secrets em um lugar).
    void CONFIG.SENHA_EXCLUSAO_DECLARACAO_HASH;
    void CONFIG.VERIFICACAO_API_KEY;

    // ===== Tempo real multiusuário =====
    // 1. Eventos do Supabase Realtime aplicam mudanças de OUTRAS máquinas no
    //    SQLite local na hora e notificam as telas (sem F5).
    iniciarRealtime();
    setOnDadosAlterados((tabelas) => {
      const lista = Array.from(tabelas);
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send(IPC_CHANNELS.DADOS_ATUALIZADOS, lista);
        } catch { /* janela fechando */ }
      }
    });
    setOnEstadoConexao((estado) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send(IPC_CHANNELS.CONEXAO_ESTADO, estado);
        } catch { /* janela fechando */ }
      }
    });
    // 2. Push acelerado: toda escrita LOCAL (mutations do usuário) agenda um
    //    sync em ~2.5s — os outros usuários recebem em segundos via realtime.
    setLocalWriteListener(() => agendarSyncRapido());

  // Sync bidirecional após 5s (não bloqueia o login inicial)
  setTimeout(() => {
    syncBidirecional(() => getDb()).catch(() => {});
    // Reenvia diplomas cujo QR ainda não foi registrado no serviço de
    // verificação web (emissões offline ou de versões antigas).
    reenviarDiplomasPendentesWeb().catch(() => {});
    // Backfill: reenvia à nuvem arquivos de declarações (PDF/XML) cujo
    // upload falhou na emissão — o "Baixar" entre máquinas depende disso.
    reenviarDeclaracoesSemArquivoNuvem().catch(() => {});
  }, 15000);
  } catch (e: any) {
    // Antes: falha silenciosa deixava o app abrir em estado quebrado.
    // Agora: loga e segue — o app pode funcionar offline mesmo sem sync.
    logger.error({ err: e }, 'Falha no boot (DB/cloud/sync)');
  }

  registrarHandlers();

  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  criarJanela();

  // Auto-update (somente em produção). Verifica no boot e a cada 4h; baixa em
  // segundo plano e instala ao fechar o app. Sem token: repo público.
  if (!isDev) {
    configurarAutoUpdate();
  }

  // Sync bidirecional automático a cada 15 segundos
  setInterval(() => {
    syncBidirecional(() => getDb()).catch((e: any) => {
      logger.warn({ err: e }, 'Sync periódico falhou');
    });
  }, 15000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
}).catch((e: any) => {
  // Erro não tratado em whenReady — antes virava UnhandledPromiseRejection silencioso.
  logger.error({ err: e }, 'Erro fatal no boot');
});

app.on('window-all-closed', () => {
  try { dbShutdown(); } catch { /* ignora */ }
  try { fecharRealtime(); } catch { /* ignora */ }
  try { fecharTunnel(); } catch { /* ignora */ }
  if (process.platform !== 'darwin') app.quit();
});
