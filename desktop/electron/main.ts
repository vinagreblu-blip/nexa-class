import { app, BrowserWindow, Menu, session, shell } from 'electron';
import path from 'node:path';
import { initDatabase } from './database';
import { shutdown as dbShutdown } from './sqlite-adapter';
import { registrarAuthHandlers } from './ipc/auth';
import { registrarAlunosHandlers } from './ipc/alunos';
import { registrarUsuariosHandlers } from './ipc/usuarios';
import { registrarDeclaracaoHandlers } from './ipc/declaracao';
import { registrarDiplomaHandlers } from './ipc/diploma';
import { registrarCursosLivresHandlers } from './ipc/cursos-livres';
import { registrarHistoricoHandlers } from './ipc/historico';
import { registrarDocentesHandlers } from './ipc/docentes';
import { registrarDisciplinasHandlers } from './ipc/disciplinas';
import { registrarDocumentosHandlers } from './ipc/documentos';
import { registrarRecuperacaoHandlers } from './ipc/recuperacao';
import { registrarSmtpHandlers } from './ipc/smtp';
import { registrarExtracaoHandlers } from './ipc/extracao';
import { registrarConversoesHandlers } from './ipc/conversoes';
import { registrarAssinaturaHandlers } from './ipc/assinatura';
import { registrarCloudHandlers } from './ipc/cloud';
import { initCloud, syncBidirecional } from './cloud';
import { getDb } from './database';
import { iniciarResetServer } from './reset-server';
import { iniciarServicoVerificacao } from './servico-verificacao';
import { iniciarTunnel, fecharTunnel } from './tunnel';
import { CONFIG } from './config';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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
  registrarCursosLivresHandlers();
  registrarHistoricoHandlers();
  registrarDocentesHandlers();
  registrarDisciplinasHandlers();
  registrarDocumentosHandlers();
  registrarRecuperacaoHandlers();
  registrarSmtpHandlers();
  registrarExtracaoHandlers();
  registrarConversoesHandlers();
  registrarAssinaturaHandlers();
  registrarCloudHandlers();
  try {
    iniciarResetServer();
  } catch (e: any) {
    console.warn('[main] Reset server não iniciado:', e?.message);
  }
  try {
    iniciarServicoVerificacao();
  } catch (e: any) {
    console.warn('[main] Serviço de verificação não iniciado:', e?.message);
  }
  // Inicia túnel público (funciona de qualquer rede)
  iniciarTunnel();
}

app.whenReady().then(async () => {
  // Aplica CSP antes de criar qualquer janela
  aplicarCsp();

  try {
    // Conecta à nuvem primeiro
    initCloud();

    // Inicializa banco de dados local
    await initDatabase();

  // Sync bidirecional após 5s (não bloqueia o login inicial)
  setTimeout(() => {
    syncBidirecional(() => getDb()).catch(() => {});
    // Sync bidirecional automático a cada 30 segundos
    setInterval(() => {
      syncBidirecional(() => getDb()).catch(() => {});
    }, 30000);
  }, 5000);
  } catch (e: any) {
    // Antes: falha silenciosa deixava o app abrir em estado quebrado.
    // Agora: loga e segue — o app pode funcionar offline mesmo sem sync.
    console.error('[main] Falha no boot (DB/cloud/sync):', e?.message);
  }

  registrarHandlers();

  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  criarJanela();

  // Sync bidirecional automático a cada 15 segundos
  setInterval(() => {
    syncBidirecional(() => getDb()).catch((e: any) => {
      console.warn('[main] Sync periódico falhou:', e?.message);
    });
  }, 15000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
}).catch((e: any) => {
  // Erro não tratado em whenReady — antes virava UnhandledPromiseRejection silencioso.
  console.error('[main] Erro fatal no boot:', e?.message);
});

app.on('window-all-closed', () => {
  // Sync final antes de fechar
  try { syncBidirecional(() => getDb()); } catch { /* ignora */ }
  // Flush síncrono do SQLite para evitar perder últimos writes
  try { dbShutdown(); } catch { /* ignora */ }
  // Encerra túnel se ativo
  try { fecharTunnel(); } catch { /* ignora */ }
  if (process.platform !== 'darwin') app.quit();
});
