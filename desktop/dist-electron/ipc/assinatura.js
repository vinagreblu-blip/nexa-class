"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assinarXml = assinarXml;
exports.getAssinaturaAtiva = getAssinaturaAtiva;
exports.registrarAssinaturaHandlers = registrarAssinaturaHandlers;
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const database_1 = require("../database");
const types_1 = require("../types");
const auth_1 = require("./auth");
function obter(_event) {
    const db = (0, database_1.getDb)();
    const row = db
        .prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1')
        .get();
    return { ok: true, data: row ?? null };
}
async function salvar(event, input) {
    if (!input.nome_signatario?.trim())
        return { ok: false, error: 'Nome do signatário é obrigatório' };
    if (!input.cargo?.trim())
        return { ok: false, error: 'Cargo é obrigatório' };
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const res = await electron_1.dialog.showOpenDialog(win, {
        title: 'Selecionar imagem da assinatura',
        properties: ['openFile'],
        filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    if (res.canceled || res.filePaths.length === 0) {
        return { ok: false, error: 'Nenhum arquivo selecionado' };
    }
    const origem = res.filePaths[0];
    const ext = node_path_1.default.extname(origem).toLowerCase() || '.png';
    const assinaturasDir = node_path_1.default.join(electron_1.app.getPath('userData'), 'assinaturas');
    if (!node_fs_1.default.existsSync(assinaturasDir))
        node_fs_1.default.mkdirSync(assinaturasDir, { recursive: true });
    const db = (0, database_1.getDb)();
    // preserva certificado se já existe
    const existente = db.prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1').get();
    db.prepare('UPDATE assinaturas SET ativo = 0').run();
    const certPath = existente?.certificado_path || null;
    const info = db
        .prepare('INSERT INTO assinaturas (nome_signatario, cargo, imagem_path, certificado_path, ativo) VALUES (?, ?, ?, ?, 1)')
        .run(input.nome_signatario.trim(), input.cargo.trim(), '', certPath);
    const novoId = info.lastInsertRowid;
    const destino = node_path_1.default.join(assinaturasDir, `assinatura_${novoId}${ext}`);
    node_fs_1.default.copyFileSync(origem, destino);
    db.prepare('UPDATE assinaturas SET imagem_path = ? WHERE id = ?').run(destino, novoId);
    const row = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(novoId);
    return { ok: true, data: row };
}
async function uploadCert(event) {
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!win)
        return { ok: false, error: 'Janela não disponível' };
    const res = await electron_1.dialog.showOpenDialog(win, {
        title: 'Selecionar Certificado Digital (.pfx/.p12)',
        properties: ['openFile'],
        filters: [{ name: 'Certificado', extensions: ['pfx', 'p12'] }],
    });
    if (res.canceled || res.filePaths.length === 0) {
        return { ok: false, error: 'Nenhum arquivo selecionado' };
    }
    const origem = res.filePaths[0];
    const ext = node_path_1.default.extname(origem).toLowerCase() || '.pfx';
    const certsDir = node_path_1.default.join(electron_1.app.getPath('userData'), 'assinaturas');
    if (!node_fs_1.default.existsSync(certsDir))
        node_fs_1.default.mkdirSync(certsDir, { recursive: true });
    const db = (0, database_1.getDb)();
    let ass = db.prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1').get();
    if (!ass) {
        const info = db.prepare('INSERT INTO assinaturas (nome_signatario, cargo, ativo) VALUES (?, ?, 1)').run('Signatário', 'Diretor Geral');
        ass = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(info.lastInsertRowid);
    }
    const destino = node_path_1.default.join(certsDir, `certificado_${ass.id}${ext}`);
    node_fs_1.default.copyFileSync(origem, destino);
    db.prepare('UPDATE assinaturas SET certificado_path = ? WHERE id = ?').run(destino, ass.id);
    const row = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(ass.id);
    return { ok: true, data: row };
}
/** Assina um XML usando o certificado .pfx com xml-crypto (XMLDSig) */
function assinarXml(xmlContent, senhaPfx) {
    const db = (0, database_1.getDb)();
    const ass = db.prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1').get();
    if (!ass?.certificado_path || !node_fs_1.default.existsSync(ass.certificado_path)) {
        return { ok: false, error: 'Nenhum certificado digital cadastrado. Vá em Assinatura Digital para cadastrar.' };
    }
    try {
        // Extrai chave privada e certificado do .pfx usando node-forge
        const forge = require('node-forge');
        const pfxBuffer = node_fs_1.default.readFileSync(ass.certificado_path);
        const pfxDer = forge.util.createBuffer(pfxBuffer.toString('binary'));
        const pfxAsn1 = forge.asn1.fromDer(pfxDer);
        const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, senhaPfx);
        // Pega a chave privada e o certificado
        let privateKeyPem = '';
        let certPem = '';
        for (const keyId in pfx.bags) {
            const bag = pfx.bags[keyId];
            if (bag.type === forge.pki.oids.pkcs8ShroudedKeyBag) {
                for (const item of bag) {
                    if (item.asn1) {
                        privateKeyPem = forge.pki.privateKeyToPem(item.key);
                    }
                }
            }
            if (bag.type === forge.pki.oids.certBag) {
                for (const item of bag) {
                    if (item.cert) {
                        certPem = forge.pki.certificateToPem(item.cert);
                    }
                }
            }
        }
        if (!privateKeyPem)
            return { ok: false, error: 'Não foi possível extrair a chave privada do certificado. Verifique a senha.' };
        if (!certPem)
            return { ok: false, error: 'Não foi possível extrair o certificado do arquivo .pfx.' };
        // Assina o XML com xml-crypto
        const { SignedXml } = require('xml-crypto');
        const sig = new SignedXml({
            privateKey: privateKeyPem,
            publicCert: certPem,
            signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
            canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
        });
        sig.addReference({
            xpath: '//*[local-name()!="Signature"]',
            digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
            transforms: [
                'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
                'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
            ],
        });
        sig.computeSignature(xmlContent);
        const signedXml = sig.getSignedXml();
        return { ok: true, xml: signedXml };
    }
    catch (e) {
        return { ok: false, error: 'Erro ao assinar XML: ' + (e?.message ?? 'verifique a senha do certificado') };
    }
}
async function assinarXmlHandler(event, xmlContent, senhaPfx) {
    const result = assinarXml(xmlContent, senhaPfx);
    if (result.ok && result.xml) {
        return { ok: true, data: { xml: result.xml } };
    }
    return { ok: false, error: result.error ?? 'Erro ao assinar XML' };
}
function getAssinaturaAtiva() {
    try {
        const db = (0, database_1.getDb)();
        const row = db
            .prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1')
            .get();
        return row ?? null;
    }
    catch {
        return null;
    }
}
function registrarAssinaturaHandlers() {
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ASSINATURA_OBTER, (0, auth_1.requerAuth)(obter));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ASSINATURA_SALVAR, (0, auth_1.requerAuth)(salvar));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ASSINATURA_UPLOAD_CERT, (0, auth_1.requerAuth)(uploadCert));
    electron_1.ipcMain.handle(types_1.IPC_CHANNELS.ASSINATURA_ASSINAR_XML, (0, auth_1.requerAuth)(assinarXmlHandler));
}
//# sourceMappingURL=assinatura.js.map