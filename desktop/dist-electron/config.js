"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG = void 0;
exports.getDbPath = getDbPath;
exports.getDbPathAntigo = getDbPathAntigo;
exports.getDbPathAntigo2 = getDbPathAntigo2;
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const network_1 = require("./network");
// Detecta IP local uma vez ao carregar (para QR Code acessível por celular na mesma rede)
const LOCAL_IP = (0, network_1.getLocalIP)();
const VERIFICACAO_PORT = 3001;
exports.CONFIG = {
    VERIFICACAO_BASE_URL: process.env.VERIFICACAO_BASE_URL ?? `http://${LOCAL_IP}:${VERIFICACAO_PORT}`,
    VERIFICACAO_API_KEY: process.env.VERIFICACAO_API_KEY ?? 'nexa-dev-api-key-trocar',
    ADMIN_SEED: {
        username: process.env.ADMIN_USERNAME ?? 'admin',
        password: process.env.ADMIN_PASSWORD ?? 'admin123',
        nome: process.env.ADMIN_NOME ?? 'Administrador',
    },
    // Hash bcrypt da senha master exigida para excluir declarações.
    // Independente da senha de login do admin. Atual: V9#qL7@tX2!mR8$zK4&nP1*Yw6^cH3
    SENHA_EXCLUSAO_DECLARACAO_HASH: '$2a$10$t7w3VQ.yI2IiWpp9zrMhkeTCpCqX1lGvVbrH1JB814N7Bhdgyj2zK',
    APP_NAME: 'NEXA CLASS',
    INSTITUICAO: 'NEXA CLASS - Network for Education and Academic Excellence Class',
    // Configuração SMTP para envio de e-mails (recuperação de senha)
    SMTP: {
        host: process.env.SMTP_HOST ?? '',
        port: Number(process.env.SMTP_PORT) ?? 587,
        user: process.env.SMTP_USER ?? '',
        pass: process.env.SMTP_PASS ?? '',
        from: process.env.SMTP_FROM ?? '',
    },
    RESET_SERVER_PORT: process.env.RESET_SERVER_PORT ? Number(process.env.RESET_SERVER_PORT) : 3456,
};
function getDbPath() {
    const userData = electron_1.app.getPath('userData');
    return node_path_1.default.join(userData, 'nexa-class.sqlite');
}
function getDbPathAntigo() {
    const userData = electron_1.app.getPath('userData');
    return node_path_1.default.join(userData, 'erich-fromm.sqlite');
}
function getDbPathAntigo2() {
    const userData = electron_1.app.getPath('userData');
    return node_path_1.default.join(userData, 'nexa.sqlite');
}
//# sourceMappingURL=config.js.map