"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const database_1 = require("./database");
const auth_1 = require("./ipc/auth");
const alunos_1 = require("./ipc/alunos");
const usuarios_1 = require("./ipc/usuarios");
const declaracao_1 = require("./ipc/declaracao");
const historico_1 = require("./ipc/historico");
const docentes_1 = require("./ipc/docentes");
const disciplinas_1 = require("./ipc/disciplinas");
const documentos_1 = require("./ipc/documentos");
const recuperacao_1 = require("./ipc/recuperacao");
const smtp_1 = require("./ipc/smtp");
const extracao_1 = require("./ipc/extracao");
const conversoes_1 = require("./ipc/conversoes");
const assinatura_1 = require("./ipc/assinatura");
const reset_server_1 = require("./reset-server");
const servico_verificacao_1 = require("./servico-verificacao");
const tunnel_1 = require("./tunnel");
const config_1 = require("./config");
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
let mainWindow = null;
function criarJanela() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        title: config_1.CONFIG.APP_NAME,
        backgroundColor: '#f5f7fa',
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
    }
    else {
        mainWindow.loadFile(node_path_1.default.join(__dirname, '../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function registrarHandlers() {
    (0, auth_1.registrarAuthHandlers)();
    (0, alunos_1.registrarAlunosHandlers)();
    (0, usuarios_1.registrarUsuariosHandlers)();
    (0, declaracao_1.registrarDeclaracaoHandlers)();
    (0, historico_1.registrarHistoricoHandlers)();
    (0, docentes_1.registrarDocentesHandlers)();
    (0, disciplinas_1.registrarDisciplinasHandlers)();
    (0, documentos_1.registrarDocumentosHandlers)();
    (0, recuperacao_1.registrarRecuperacaoHandlers)();
    (0, smtp_1.registrarSmtpHandlers)();
    (0, extracao_1.registrarExtracaoHandlers)();
    (0, conversoes_1.registrarConversoesHandlers)();
    (0, assinatura_1.registrarAssinaturaHandlers)();
    try {
        (0, reset_server_1.iniciarResetServer)();
    }
    catch (e) {
        console.warn('[main] Reset server não iniciado:', e?.message);
    }
    try {
        (0, servico_verificacao_1.iniciarServicoVerificacao)();
    }
    catch (e) {
        console.warn('[main] Serviço de verificação não iniciado:', e?.message);
    }
    // Inicia túnel público (funciona de qualquer rede)
    (0, tunnel_1.iniciarTunnel)();
}
electron_1.app.whenReady().then(async () => {
    await (0, database_1.initDatabase)();
    registrarHandlers();
    if (!isDev) {
        electron_1.Menu.setApplicationMenu(null);
    }
    criarJanela();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            criarJanela();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
//# sourceMappingURL=main.js.map