import { ipcMain, IpcMainInvokeEvent, dialog, BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAuth } from './auth';

export interface Assinatura {
  id: number;
  nome_signatario: string;
  cargo: string;
  imagem_path: string | null;
  certificado_path: string | null;
  ativo: number;
}

function obter(_event: IpcMainInvokeEvent): ApiResult<Assinatura | null> {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1')
    .get() as Assinatura | undefined;
  return { ok: true, data: row ?? null };
}

async function salvar(
  event: IpcMainInvokeEvent,
  input: { nome_signatario: string; cargo: string }
): Promise<ApiResult<Assinatura>> {
  if (!input.nome_signatario?.trim()) return { ok: false, error: 'Nome do signatário é obrigatório' };
  if (!input.cargo?.trim()) return { ok: false, error: 'Cargo é obrigatório' };

  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const res = await dialog.showOpenDialog(win, {
    title: 'Selecionar imagem da assinatura',
    properties: ['openFile'],
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg'] }],
  });

  if (res.canceled || res.filePaths.length === 0) {
    return { ok: false, error: 'Nenhum arquivo selecionado' };
  }

  const origem = res.filePaths[0];
  const ext = path.extname(origem).toLowerCase() || '.png';
  const assinaturasDir = path.join(app.getPath('userData'), 'assinaturas');
  if (!fs.existsSync(assinaturasDir)) fs.mkdirSync(assinaturasDir, { recursive: true });

  const db = getDb();
  // preserva certificado se já existe
  const existente = db.prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1').get() as Assinatura | undefined;
  db.prepare('UPDATE assinaturas SET ativo = 0').run();

  const certPath = existente?.certificado_path || null;
  const info = db
    .prepare('INSERT INTO assinaturas (nome_signatario, cargo, imagem_path, certificado_path, ativo) VALUES (?, ?, ?, ?, 1)')
    .run(input.nome_signatario.trim(), input.cargo.trim(), '', certPath);
  const novoId = info.lastInsertRowid as number;
  const destino = path.join(assinaturasDir, `assinatura_${novoId}${ext}`);
  fs.copyFileSync(origem, destino);
  db.prepare('UPDATE assinaturas SET imagem_path = ? WHERE id = ?').run(destino, novoId);

  const row = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(novoId) as Assinatura;
  return { ok: true, data: row };
}

async function uploadCert(
  event: IpcMainInvokeEvent
): Promise<ApiResult<Assinatura>> {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const res = await dialog.showOpenDialog(win, {
    title: 'Selecionar Certificado Digital (.pfx/.p12)',
    properties: ['openFile'],
    filters: [{ name: 'Certificado', extensions: ['pfx', 'p12'] }],
  });

  if (res.canceled || res.filePaths.length === 0) {
    return { ok: false, error: 'Nenhum arquivo selecionado' };
  }

  const origem = res.filePaths[0];
  const ext = path.extname(origem).toLowerCase() || '.pfx';
  const certsDir = path.join(app.getPath('userData'), 'assinaturas');
  if (!fs.existsSync(certsDir)) fs.mkdirSync(certsDir, { recursive: true });

  const db = getDb();
  let ass = db.prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1').get() as Assinatura | undefined;

  if (!ass) {
    const info = db.prepare('INSERT INTO assinaturas (nome_signatario, cargo, ativo) VALUES (?, ?, 1)').run('Signatário', 'Diretor Geral');
    ass = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(info.lastInsertRowid) as Assinatura;
  }

  const destino = path.join(certsDir, `certificado_${ass.id}${ext}`);
  fs.copyFileSync(origem, destino);
  db.prepare('UPDATE assinaturas SET certificado_path = ? WHERE id = ?').run(destino, ass.id);

  const row = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(ass.id) as Assinatura;
  return { ok: true, data: row };
}

/** Assina um XML usando o certificado .pfx com xml-crypto (XMLDSig) */
export function assinarXml(xmlContent: string, senhaPfx: string): { ok: boolean; xml?: string; error?: string } {
  const db = getDb();
  const ass = db.prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1').get() as Assinatura | undefined;

  if (!ass?.certificado_path || !fs.existsSync(ass.certificado_path)) {
    return { ok: false, error: 'Nenhum certificado digital cadastrado. Vá em Assinatura Digital para cadastrar.' };
  }

  try {
    // Extrai chave privada e certificado do .pfx usando node-forge
    const forge = require('node-forge');
    const pfxBuffer = fs.readFileSync(ass.certificado_path);
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

    if (!privateKeyPem) return { ok: false, error: 'Não foi possível extrair a chave privada do certificado. Verifique a senha.' };
    if (!certPem) return { ok: false, error: 'Não foi possível extrair o certificado do arquivo .pfx.' };

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
  } catch (e: any) {
    return { ok: false, error: 'Erro ao assinar XML: ' + (e?.message ?? 'verifique a senha do certificado') };
  }
}

async function assinarXmlHandler(
  event: IpcMainInvokeEvent,
  xmlContent: string,
  senhaPfx: string
): Promise<ApiResult<{ xml: string }>> {
  const result = assinarXml(xmlContent, senhaPfx);
  if (result.ok && result.xml) {
    return { ok: true, data: { xml: result.xml } };
  }
  return { ok: false, error: result.error ?? 'Erro ao assinar XML' };
}

export function getAssinaturaAtiva(): Assinatura | null {
  try {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1')
      .get() as Assinatura | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export function registrarAssinaturaHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_OBTER, requerAuth(obter));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_SALVAR, requerAuth(salvar));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_UPLOAD_CERT, requerAuth(uploadCert));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_ASSINAR_XML, requerAuth(assinarXmlHandler));
}
