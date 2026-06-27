import { app, BrowserWindow, Menu } from 'electron';
import path from 'node:path';
import { initDatabase } from './database';
import { registrarAuthHandlers } from './ipc/auth';
import { registrarAlunosHandlers } from './ipc/alunos';
import { registrarUsuariosHandlers } from './ipc/usuarios';
import { registrarDeclaracaoHandlers } from './ipc/declaracao';
import { registrarHistoricoHandlers } from './ipc/historico';
import { registrarDocentesHandlers } from './ipc/docentes';
import { registrarDisciplinasHandlers } from './ipc/disciplinas';
import { registrarDocumentosHandlers } from './ipc/documentos';
import { registrarRecuperacaoHandlers } from './ipc/recuperacao';
import { registrarSmtpHandlers } from './ipc/smtp';
import { registrarExtracaoHandlers } from './ipc/extracao';
import { registrarConversoesHandlers } from './ipc/conversoes';
import { registrarAssinaturaHandlers } from './ipc/assinatura';
import { iniciarResetServer } from './reset-server';
import { iniciarServicoVerificacao } from './servico-verificacao';
import { iniciarTunnel } from './tunnel';
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
  registrarHistoricoHandlers();
  registrarDocentesHandlers();
  registrarDisciplinasHandlers();
  registrarDocumentosHandlers();
  registrarRecuperacaoHandlers();
  registrarSmtpHandlers();
  registrarExtracaoHandlers();
  registrarConversoesHandlers();
  registrarAssinaturaHandlers();
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
  await initDatabase();
  registrarHandlers();

  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  criarJanela();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
