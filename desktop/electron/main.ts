import { app, BrowserWindow, Menu } from 'electron';
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
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
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
  // Conecta à nuvem primeiro
  initCloud();

  // Inicializa banco de dados local
  await initDatabase();

  // Sync bidirecional inicial (baixa dados mais recentes + envia locais)
  await syncBidirecional(() => getDb());

  // NÃO baixa arquivos da nuvem no boot — .pfx (chave privada ICP-Brasil) e assinaturas
  // não devem circular entre máquinas. Cada máquina cadastra seus próprios localmente.

  registrarHandlers();

  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  criarJanela();

  // Sync bidirecional automático a cada 15 segundos
  setInterval(() => { syncBidirecional(() => getDb()); }, 15000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
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
