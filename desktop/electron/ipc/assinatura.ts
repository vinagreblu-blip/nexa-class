import type { IpcMainInvokeEvent} from 'electron';
import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getDb } from '../database';
import { IPC_CHANNELS } from '../types';
import type { ApiResult } from '../types';
import { requerAuth } from './auth';
import { logger } from '../utils/logger';
// uploadFileToCloud removido: NÃO subir .pfx (chave privada ICP-Brasil) nem assinaturas
// para a nuvem — expõe material criptográfico sensível em storage compartilhado.
// Cada máquina cadastra seu próprio certificado localmente.

export interface Assinatura {
  id: number;
  nome_signatario: string;
  cargo: string;
  imagem_path: string | null;
  certificado_path: string | null;
  certificado_tipo: 'A1' | 'A3' | null;
  certificado_a3_thumbprint: string | null;
  ativo: number;
}

/** Certificado encontrado no Windows Certificate Store (A3). */
export interface CertA3Info {
  thumbprint: string;
  subject: string;
  issuer: string;
  notBefore: string; // ISO 8601
  notAfter: string; // ISO 8601
  hasPrivateKey: boolean;
  /** true se a chave privada realmente abre (token conectado + middleware instalado). */
  keyAcessivel: boolean;
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
  const certTipo = existente?.certificado_tipo ?? null;
  const certThumb = existente?.certificado_a3_thumbprint ?? null;
  const info = db
    .prepare('INSERT INTO assinaturas (nome_signatario, cargo, imagem_path, certificado_path, certificado_tipo, certificado_a3_thumbprint, ativo) VALUES (?, ?, ?, ?, ?, ?, 1)')
    .run(input.nome_signatario.trim(), input.cargo.trim(), '', certPath, certTipo, certThumb);
  const novoId = info.lastInsertRowid as number;
  const destino = path.join(assinaturasDir, `assinatura_${novoId}${ext}`);
  fs.copyFileSync(origem, destino);
  db.prepare('UPDATE assinaturas SET imagem_path = ? WHERE id = ?').run(destino, novoId);

  // NÃO envia mais a imagem para a nuvem — fica apenas local.
  // Se houver sync entre máquinas, cada uma cadastra sua própria assinatura/certificado.

  const row = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(novoId) as Assinatura;
  return { ok: true, data: row };
}

async function uploadCert(
  event: IpcMainInvokeEvent,
  tipo?: string
): Promise<ApiResult<Assinatura>> {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Janela não disponível' };

  const tipoCert = (tipo === 'A3') ? 'A3' : 'A1';

  const res = await dialog.showOpenDialog(win, {
    title: `Selecionar Certificado Digital ${tipoCert} (.pfx/.p12)`,
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

  const destino = path.join(certsDir, `certificado_${tipoCert}_${ass.id}${ext}`);
  fs.copyFileSync(origem, destino);
  db.prepare('UPDATE assinaturas SET certificado_path = ?, certificado_tipo = ?, certificado_a3_thumbprint = NULL WHERE id = ?').run(destino, tipoCert, ass.id);

  // NÃO envia o .pfx (chave privada ICP-Brasil) para a nuvem — viola MP 2.200-2/2001.
  // O certificado fica APENAS no disco local desta máquina.

  const row = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(ass.id) as Assinatura;
  return { ok: true, data: row };
}

// ---------------------------------------------------------------------------
// Certificado A3 via Windows Certificate Store
//
// O A3 (token USB / SmartCard) NÃO é um arquivo .pfx. O certificado público é
// publicado no repositório "Current User -> My" pelo middleware do fabricante
// (Safenet, Pronova, Gemalto...). A chave privada permanece dentro do hardware.
//
// - Listagem: PowerShell lê Cert:\CurrentUser\My
// - Assinatura: .NET SignedXml chama a chave do token (o driver pede o PIN)
// ---------------------------------------------------------------------------

// PowerShell: lista certificados com chave privada via X509Store (.NET) — NÃO usa o
// provider "Cert:" do PowerShell, que pode travar quando há token/SmartCard conectado
// (invoca o CSP do fabricante p/ enumerar). O X509Store.Open(ReadOnly) só lê os objetos,
// sem acionar o CSP. JSON gravado em arquivo UTF-8 (evita bug de codepage do stdout).
const PS_LISTAR_A3 = `
param([string]$OutFile)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$certs = @()
$locs = @(
  ([System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser),
  ([System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
)
foreach ($loc in $locs) {
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) {
      if ($c.HasPrivateKey) {
        # Testa se a chave privada realmente abre (sem pedir PIN — apenas adquire o
        # contexto do CSP/KSP). Certificado listado sem chave acessivel = token
        # desconectado ou middleware do fabricante ausente — avisa na importacao.
        $keyOk = $false
        try {
          $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c)
          if ($null -eq $k) { $k = $c.PrivateKey }
          if ($null -ne $k) { $keyOk = $true; try { $k.Dispose() } catch {} }
        } catch { $keyOk = $false }
        $certs += [pscustomobject]@{
          Thumbprint    = $c.Thumbprint
          Subject       = $c.Subject
          Issuer        = $c.Issuer
          NotBefore     = $c.NotBefore.ToString('o')
          NotAfter      = $c.NotAfter.ToString('o')
          HasPrivateKey = $c.HasPrivateKey
          KeyAcessivel  = $keyOk
        }
      }
    }
    $store.Close()
  } catch {}
}
$unique = @($certs | Sort-Object Thumbprint -Unique)
$json = [pscustomobject]@{ Certs = @($unique) } | ConvertTo-Json -Compress -Depth 5
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'OK'
`.trim();

// PowerShell: assina o XML (enveloped, C14N, SHA-256) com a chave do token.
const PS_ASSINAR_A3 = `
param([string]$Thumbprint, [string]$InFile, [string]$OutFile)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName System.Security

# Busca TODOS os certificados com o thumbprint (CurrentUser E LocalMachine, via
# X509Store — sem o provider Cert:, que trava em token) e usa o primeiro cuja
# chave privada realmente ABRE. Uma copia sem chave acessivel (ex.: importada
# sem o middleware do token) nao pode bloquear a copia boa do outro repositorio.
$candidatos = @()
$locs = @(([System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser), ([System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine))
foreach ($loc in $locs) {
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) { if ($c.Thumbprint -ieq $Thumbprint) { $candidatos += $c } }
    $store.Close()
  } catch {}
}
if ($candidatos.Count -eq 0) { throw 'Certificado nao encontrado no repositorio do Windows (CurrentUser/LocalMachine). Reimporte o certificado A3 em Assinatura Digital.' }
$cert = $null
$rsaKey = $null
foreach ($cand in $candidatos) {
  # GetRSAPrivateKey() so existe no .NET 4.6+ (metodo de extensao) — chamada estatica;
  # em .NET antigo cai no $cand.PrivateKey. Qualquer falha tenta o proximo candidato.
  try {
    $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cand)
    if ($null -eq $k) { $k = $cand.PrivateKey }
    if ($null -ne $k) { $cert = $cand; $rsaKey = $k; break }
  } catch {}
}
if ($null -eq $rsaKey) { throw 'Chave privada nao acessivel: o certificado foi encontrado, mas o Windows nao conseguiu abrir a chave do token. Conecte o token/SmartCard e instale o middleware do fabricante (Safenet, Pronova, Gemalto, Watchdata...).' }

$xmlIn = [System.IO.File]::ReadAllText($InFile, [System.Text.Encoding]::UTF8)
$doc = New-Object System.Xml.XmlDocument
$doc.PreserveWhitespace = $true
$doc.LoadXml($xmlIn)

$signedXml = New-Object System.Security.Cryptography.Xml.SignedXml($doc)
$signedXml.SigningKey = $rsaKey
$signedXml.SignedInfo.CanonicalizationMethod = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
$signedXml.SignedInfo.SignatureMethod = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'

$ref = New-Object System.Security.Cryptography.Xml.Reference
$ref.Uri = ''
$ref.DigestMethod = 'http://www.w3.org/2001/04/xmlenc#sha256'
$ref.AddTransform((New-Object System.Security.Cryptography.Xml.EnvelopedSignatureTransform))
$ref.AddTransform((New-Object System.Security.Cryptography.Xml.XmlDsigC14NTransform))
$signedXml.AddReference($ref)

$keyInfo = New-Object System.Security.Cryptography.Xml.KeyInfo
$x509 = New-Object System.Security.Cryptography.Xml.KeyInfoX509Data
$x509.AddCertificate($cert)
$keyInfo.AddClause($x509)
$signedXml.KeyInfo = $keyInfo

$signedXml.ComputeSignature()
$sig = $signedXml.GetXml()
$doc.DocumentElement.AppendChild($doc.ImportNode($sig, $true)) | Out-Null

[System.IO.File]::WriteAllText($OutFile, $doc.OuterXml, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'OK'
`.trim();

/** Resolve o caminho completo do powershell.exe (mais robusto no app empacotado). */
function resolverPowerShell(): string {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(full) ? full : 'powershell.exe';
}

/**
 * Executa um script PowerShell a partir de um arquivo .ps1 temporário (evita escaping).
 * NÃO bloqueia o event loop do Electron (usa spawn) — essencial para não congelar a UI
 * enquanto o usuário digita o PIN do token A3.
 */
export function runPowerShellScriptAsync(
  scriptBody: string,
  params: Record<string, string> = {},
  timeoutMs = 120000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(os.tmpdir(), `nexa_a3_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
    fs.writeFileSync(scriptPath, scriptBody, 'utf8');
    const paramArgs: string[] = [];
    for (const [k, v] of Object.entries(params)) paramArgs.push(`-${k}`, v);

    const child = spawn(resolverPowerShell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...paramArgs], {
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      try { fs.unlinkSync(scriptPath); } catch { /* noop */ }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* noop */ }
      cleanup();
      reject(new Error('Tempo esgotado aguardando o token/PIN. Verifique se o token está conectado e tente novamente.'));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Não foi possível iniciar o PowerShell: ' + (err?.message ?? String(err))));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `PowerShell encerrou com código ${code}`));
    });
  });
}

/** Traduz mensagens comuns de erro de token A3 para PT-BR. */
export function traduzirErroA3(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('the smart card') || m.includes('cartao') || m.includes('card is not supported')) {
    return 'Token/SmartCard não detectado ou driver não instalado. Conecte o token e instale o middleware do fabricante (Safenet, Pronova, etc.).';
  }
  if (m.includes('pin') || m.includes('cancelled by the user') || m.includes('cancel')) {
    return 'Operação cancelada ou PIN inválido. Tente novamente e informe o PIN do token quando solicitado.';
  }
  if (m.includes('chave privada nao acessivel') || m.includes('nao conseguiu abrir a chave')) {
    return 'Chave privada do token inacessível: o certificado foi encontrado, mas o driver não abriu a chave. Conecte o token e instale o middleware do fabricante (Safenet, Pronova, Gemalto, Watchdata…).';
  }
  if (m.includes('cannot find subitem') || m.includes('nao encontrado')) {
    return 'Certificado não encontrado no repositório do Windows. Reimporte o certificado A3.';
  }
  return 'Erro ao assinar com o token: ' + (msg || 'verifique o token e o driver');
}

/** Lista certificados A3 disponíveis no Windows Certificate Store. */
async function listarCertsA3(_event: IpcMainInvokeEvent): Promise<ApiResult<CertA3Info[]>> {
  const outFile = path.join(os.tmpdir(), `nexa_certs_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  try {
    logger.info({ outFile }, 'listarCertsA3: iniciando leitura X509Store');
    await runPowerShellScriptAsync(PS_LISTAR_A3, { OutFile: outFile }, 25000);
    if (!fs.existsSync(outFile)) {
      logger.warn({ outFile }, 'listarCertsA3: PowerShell não gravou a lista');
      return { ok: false, error: 'O PowerShell não gravou a lista de certificados.' };
    }
    const content = fs.readFileSync(outFile, 'utf8').trim();
    if (!content) {
      logger.info('listarCertsA3: lista vazia');
      return { ok: true, data: [] };
    }
    const parsed = JSON.parse(content) as { Certs?: any };
    // O PowerShell (ConvertTo-Json) emite chaves PascalCase (Subject, Issuer...) e,
    // com um único certificado, serializa como objeto em vez de array. Normalizamos
    // tudo para camelCase (contrato do CertA3Info) e garantimos um array.
    const rawCerts = Array.isArray(parsed.Certs)
      ? parsed.Certs
      : (parsed.Certs && typeof parsed.Certs === 'object' ? [parsed.Certs] : []);
    const lista: CertA3Info[] = rawCerts.map((c: any) => ({
      thumbprint: String(c?.Thumbprint ?? c?.thumbprint ?? ''),
      subject: String(c?.Subject ?? c?.subject ?? ''),
      issuer: String(c?.Issuer ?? c?.issuer ?? ''),
      notBefore: String(c?.NotBefore ?? c?.notBefore ?? ''),
      notAfter: String(c?.NotAfter ?? c?.notAfter ?? ''),
      hasPrivateKey: Boolean(c?.HasPrivateKey ?? c?.hasPrivateKey ?? false),
      keyAcessivel: Boolean(c?.KeyAcessivel ?? c?.keyAcessivel ?? false),
    }));
    logger.info({ total: lista.length }, 'listarCertsA3: leitura concluída');
    return { ok: true, data: lista };
  } catch (e: any) {
    const msg = (e?.stderr?.toString?.() ?? e?.message ?? '').toString();
    logger.error({ err: msg }, 'listarCertsA3: falha ao ler o Windows Certificate Store');
    const dica = msg.toLowerCase().includes('tempo esgotado')
      ? ' Tempo esgotado — pode ser o driver do token travando a leitura; reconecte o pendrive e tente novamente.'
      : '';
    return { ok: false, error: 'Não foi possível ler o Windows Certificate Store: ' + msg + dica };
  } finally {
    try { fs.unlinkSync(outFile); } catch { /* noop */ }
  }
}

/** Salva o thumbprint do certificado A3 selecionado na assinatura ativa. */
function salvarCertA3(_event: IpcMainInvokeEvent, thumbprint: string): ApiResult<Assinatura> {
  if (!thumbprint || !/^[0-9a-fA-F]+$/.test(thumbprint)) {
    return { ok: false, error: 'Thumbprint inválido' };
  }
  const db = getDb();
  let ass = db.prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1').get() as Assinatura | undefined;
  if (!ass) {
    const info = db.prepare('INSERT INTO assinaturas (nome_signatario, cargo, ativo) VALUES (?, ?, 1)').run('Signatário', 'Diretor Geral');
    ass = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(info.lastInsertRowid) as Assinatura;
  }
  db.prepare('UPDATE assinaturas SET certificado_path = NULL, certificado_tipo = ?, certificado_a3_thumbprint = ? WHERE id = ?')
    .run('A3', thumbprint.toUpperCase(), ass.id);
  const row = db.prepare('SELECT * FROM assinaturas WHERE id = ?').get(ass.id) as Assinatura;
  return { ok: true, data: row };
}

/** Pré-visualização da imagem da assinatura como dataURL (evita require('fs') no renderer). */
function previewImagem(_event: IpcMainInvokeEvent): ApiResult<{ dataUrl: string | null }> {
  const db = getDb();
  const row = db
    .prepare('SELECT imagem_path FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1')
    .get() as { imagem_path: string | null } | undefined;
  const p = row?.imagem_path;
  if (!p || !fs.existsSync(p)) return { ok: true, data: { dataUrl: null } };
  try {
    const buf = fs.readFileSync(p);
    const ext = path.extname(p).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return { ok: true, data: { dataUrl: `data:${mime};base64,${buf.toString('base64')}` } };
  } catch {
    return { ok: true, data: { dataUrl: null } };
  }
}

/** Assina um XML via XMLDSig (SHA-256 + RSA). Suporta A1 (.pfx) e A3 (token/SmartCard). */
export async function assinarXml(
  xmlContent: string,
  senhaPfx: string
): Promise<{ ok: boolean; xml?: string; error?: string }> {
  const db = getDb();
  const ass = db.prepare('SELECT * FROM assinaturas WHERE ativo = 1 ORDER BY id DESC LIMIT 1').get() as Assinatura | undefined;

  if (!ass) {
    return { ok: false, error: 'Nenhum certificado digital cadastrado. Vá em Assinatura Digital para cadastrar.' };
  }

  // ----- A3: token/SmartCard via Windows Certificate Store -----
  if (ass.certificado_tipo === 'A3' && ass.certificado_a3_thumbprint) {
    return assinarXmlA3(ass.certificado_a3_thumbprint, xmlContent);
  }

  // ----- A1: arquivo .pfx no disco -----
  if (!ass.certificado_path || !fs.existsSync(ass.certificado_path)) {
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
      const bags = pfx.bags[keyId];
      if (!Array.isArray(bags)) continue;
      for (const item of bags) {
        if (item.type === forge.pki.oids.pkcs8ShroudedKeyBag && item.asn1) {
          privateKeyPem = forge.pki.privateKeyToPem(item.key);
        }
        if (item.type === forge.pki.oids.certBag && item.cert) {
          certPem = forge.pki.certificateToPem(item.cert);
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

/** Assina o XML usando a chave privada do token A3 (a chave nunca sai do hardware). */
async function assinarXmlA3(
  thumbprint: string,
  xmlContent: string
): Promise<{ ok: boolean; xml?: string; error?: string }> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inFile = path.join(os.tmpdir(), `nexa_a3_in_${id}.xml`);
  const outFile = path.join(os.tmpdir(), `nexa_a3_out_${id}.xml`);
  fs.writeFileSync(inFile, xmlContent, 'utf8');
  try {
    await runPowerShellScriptAsync(PS_ASSINAR_A3, { Thumbprint: thumbprint, InFile: inFile, OutFile: outFile }, 120000);
    if (!fs.existsSync(outFile)) {
      return { ok: false, error: 'Falha ao assinar com o token. Saída não gerada.' };
    }
    const signed = fs.readFileSync(outFile, 'utf8');
    return { ok: true, xml: signed };
  } catch (e: any) {
    const msg = (e?.stderr?.toString?.() ?? e?.message ?? '').toString();
    return { ok: false, error: traduzirErroA3(msg) };
  } finally {
    try { fs.unlinkSync(inFile); } catch { /* noop */ }
    try { fs.unlinkSync(outFile); } catch { /* noop */ }
  }
}

async function assinarXmlHandler(
  _event: IpcMainInvokeEvent,
  xmlContent: string,
  senhaPfx: string
): Promise<ApiResult<{ xml: string }>> {
  const result = await assinarXml(xmlContent, senhaPfx);
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
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_LISTAR_CERTS_A3, requerAuth(listarCertsA3));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_SALVAR_CERT_A3, requerAuth(salvarCertA3));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_ASSINAR_XML, requerAuth(assinarXmlHandler));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_PREVIEW_IMAGEM, requerAuth(previewImagem));
}
