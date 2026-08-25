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
import { traduzirErroA3, erroCertificadoAusente, erroCertificadoExpirado, erroChaveInacessivel, extrairUltimaFase } from '../assinatura-erros';

// Re-export para compatibilidade (pades.ts e outros importam daqui).
export { traduzirErroA3 };
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
  /** Algoritmo da chave: 'RSA' | 'ECC'. */
  algorithm: string;
  /** Repositório onde a cópia foi encontrada: 'CurrentUser' | 'LocalMachine'. */
  store: string;
}

/** Resultado do teste de assinatura A3 (botão "Testar assinatura"). */
export interface TesteA3Resultado {
  encontrado: boolean;
  certificados: { store: string; algorithm: string; keyAcessivel: boolean }[];
  /** true se a assinatura de teste foi concluída (PIN aceito pelo driver). */
  assinou: boolean;
  /** Mensagem de erro da assinatura de teste, se houver. */
  erro?: string;
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
// Inclui Store (CurrentUser/LocalMachine), Algorithm (RSA/ECC) e KeyAcessivel (testa
// abrir a chave via RSA OU ECDsa, sem pedir PIN — só adquire o contexto do CSP/KSP).
const PS_LISTAR_A3 = `
param([string]$OutFile)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$certs = @()
$locs = @('CurrentUser', 'LocalMachine')
foreach ($locName in $locs) {
  $loc = [System.Security.Cryptography.X509Certificates.StoreLocation]::$locName
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) {
      if ($c.HasPrivateKey) {
        $algName = 'RSA'
        try { $oidName = $c.PublicKey.Oid.FriendlyName; if ($oidName -match 'ecc|ecdsa') { $algName = 'ECC' } } catch {}
        $keyOk = $false
        try {
          $k = $null
          try { $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c) } catch { $k = $null }
          if ($null -eq $k) { try { $k = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($c) } catch { $k = $null } }
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
          Algorithm     = $algName
          Store         = $locName
        }
      }
    }
    $store.Close()
  } catch {}
}
$unique = @($certs | Sort-Object Thumbprint, Store -Unique)
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
Write-Output 'FASE:store-ok'
$cert = $null
$signKey = $null
$keyAlg = 'RSA'
foreach ($cand in $candidatos) {
  # Abre a chave privada (RSA OU ECDsa — certificados ICP-Brasil novos podem ser ECC).
  # Metodos de extensao do .NET 4.6+ chamados de forma estatica; fallback $cand.PrivateKey.
  try {
    $k = $null
    try { $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cand) } catch { $k = $null }
    if ($null -ne $k) { $keyAlg = 'RSA' } else {
      try { $k = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($cand) } catch { $k = $null }
      if ($null -ne $k) { $keyAlg = 'ECC' } else { $k = $cand.PrivateKey }
    }
    if ($null -ne $k) { $cert = $cand; $signKey = $k; break }
  } catch {}
}
if ($null -eq $signKey) { throw 'Chave privada nao acessivel: o certificado foi encontrado, mas o Windows nao conseguiu abrir a chave do token. Conecte o token/SmartCard e instale o middleware do fabricante (Safenet, Pronova, Gemalto, Watchdata...).' }
Write-Output "FASE:chave-ok-$keyAlg"

$xmlIn = [System.IO.File]::ReadAllText($InFile, [System.Text.Encoding]::UTF8)
$doc = New-Object System.Xml.XmlDocument
$doc.PreserveWhitespace = $true
$doc.LoadXml($xmlIn)
Write-Output 'FASE:xml-ok'

$signedXml = New-Object System.Security.Cryptography.Xml.SignedXml($doc)
$signedXml.SigningKey = $signKey
$signedXml.SignedInfo.CanonicalizationMethod = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
if ($keyAlg -eq 'ECC') {
  $signedXml.SignedInfo.SignatureMethod = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256'
} else {
  $signedXml.SignedInfo.SignatureMethod = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
}

$ref = New-Object System.Security.Cryptography.Xml.Reference
$ref.Uri = ''
$ref.DigestMethod = 'http://www.w3.org/2001/04/xmlenc#sha256'
# No .NET Framework o transform enveloped chama-se XmlDsigEnvelopedSignatureTransform;
# no .NET Core/5+ e apenas EnvelopedSignatureTransform. Resolve pelo assembly do
# proprio SignedXml (garante o assembly certo mesmo se Add-Type parcial falhar).
$envT = [System.Security.Cryptography.Xml.SignedXml].Assembly.GetType('System.Security.Cryptography.Xml.XmlDsigEnvelopedSignatureTransform', $false)
if ($null -eq $envT) { $envT = [System.Security.Cryptography.Xml.SignedXml].Assembly.GetType('System.Security.Cryptography.Xml.EnvelopedSignatureTransform', $false) }
if ($null -eq $envT) { throw 'Transform enveloped (XMLDSig) nao encontrado no .NET instalado.' }
$ref.AddTransform([Activator]::CreateInstance($envT))
$ref.AddTransform((New-Object System.Security.Cryptography.Xml.XmlDsigC14NTransform))
$signedXml.AddReference($ref)

$keyInfo = New-Object System.Security.Cryptography.Xml.KeyInfo
$x509 = New-Object System.Security.Cryptography.Xml.KeyInfoX509Data
$x509.AddCertificate($cert)
$keyInfo.AddClause($x509)
$signedXml.KeyInfo = $keyInfo

if ($keyAlg -eq 'ECC') {
  # O SignedXml do .NET Framework NAO traz SignatureDescription para ecdsa-sha256
  # (suporte nativo so no .NET Core 3+), o que gera "O SignatureDescription nao
  # pôde ser criado para o algoritmo de assinatura fornecido". Registra um
  # customizado: ECDsa cuja saida SignHash e r||s — exatamente o formato que o
  # XMLDSig ECDSA (RFC 4051) exige.
  if (-not ('ECDsaP1363SignatureDescription' -as [type])) {
    Add-Type -TypeDefinition @'
using System.Security.Cryptography;

public class ECDsaP1363SignatureFormatter : AsymmetricSignatureFormatter {
    private ECDsa _key;
    public override void SetKey(AsymmetricAlgorithm key) { _key = (ECDsa)key; }
    public override void SetHashAlgorithm(string name) { }
    public override byte[] CreateSignature(byte[] hash) {
        // .NET Framework so traz SignHash(byte[]) (sem HashAlgorithmName — isso e
        // .NET Core). Basta: ECDSA assina os bytes do digest SHA-256 direto (r||s).
        return _key.SignHash(hash);
    }
}
public class ECDsaP1363SignatureDeformatter : AsymmetricSignatureDeformatter {
    private ECDsa _key;
    public override void SetKey(AsymmetricAlgorithm key) { _key = (ECDsa)key; }
    public override void SetHashAlgorithm(string name) { }
    public override bool VerifySignature(byte[] hash, byte[] signature) {
        return _key.VerifyHash(hash, signature);
    }
}
public class ECDsaP1363SignatureDescription : SignatureDescription {
    public ECDsaP1363SignatureDescription() {
        KeyAlgorithm = typeof(ECDsa).AssemblyQualifiedName;
        DigestAlgorithm = "SHA256";
        FormatterAlgorithm = typeof(ECDsaP1363SignatureFormatter).AssemblyQualifiedName;
        DeformatterAlgorithm = typeof(ECDsaP1363SignatureDeformatter).AssemblyQualifiedName;
    }
}
'@
  }
  [System.Security.Cryptography.CryptoConfig]::AddAlgorithm([ECDsaP1363SignatureDescription], 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256')
}

Write-Output 'FASE:assinando'
$signedXml.ComputeSignature()
Write-Output 'FASE:assinado'
$sig = $signedXml.GetXml()
$doc.DocumentElement.AppendChild($doc.ImportNode($sig, $true)) | Out-Null

[System.IO.File]::WriteAllText($OutFile, $doc.OuterXml, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'OK'
`.trim();

// PowerShell: teste de assinatura A3 SEM emitir documento. Fase 1 diagnostica
// (acha o cert, algoritmo, repositorio e se a chave abre — sem pedir PIN); fase 2,
// se ha chave acessivel, assina um payload minimo via SignedCms (o driver pede o
// PIN). Resultado em JSON estruturado (erros da fase 2 nao abortam o exit code).
const PS_TESTAR_A3 = `
param([string]$Thumbprint, [string]$OutFile)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName System.Security

$result = [ordered]@{ Encontrado = $false; Certs = @(); Assinou = $false; Erro = '' }
$candidatos = @()
$infos = @()
$locs = @('CurrentUser', 'LocalMachine')
foreach ($locName in $locs) {
  $loc = [System.Security.Cryptography.X509Certificates.StoreLocation]::$locName
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) {
      if ($c.Thumbprint -ieq $Thumbprint) {
        $algName = 'RSA'
        try { $oidName = $c.PublicKey.Oid.FriendlyName; if ($oidName -match 'ecc|ecdsa') { $algName = 'ECC' } } catch {}
        $k = $null
        try { $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c) } catch { $k = $null }
        if ($null -eq $k) { try { $k = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($c) } catch { $k = $null } }
        if ($null -eq $k) { $k = $c.PrivateKey }
        $keyOk = $null -ne $k
        if ($keyOk) { try { $k.Dispose() } catch {} }
        $infos += [pscustomobject]@{ Store = $locName; Algorithm = $algName; KeyAcessivel = $keyOk }
        if ($keyOk) { $candidatos += $c }
      }
    }
    $store.Close()
  } catch {}
}
$result.Certs = @($infos)
if ($infos.Count -gt 0) { $result.Encontrado = $true }
Write-Output 'FASE:store-ok'

if ($candidatos.Count -gt 0) {
  try {
    $cert = $candidatos[0]
    $data = [System.Text.Encoding]::UTF8.GetBytes('nexa-teste-assinatura')
    $content = New-Object System.Security.Cryptography.Pkcs.ContentInfo -ArgumentList (,[byte[]]$data)
    $cms = New-Object System.Security.Cryptography.Pkcs.SignedCms -ArgumentList $content, $true
    $signer = New-Object System.Security.Cryptography.Pkcs.CmsSigner($cert)
    $signer.DigestAlgorithm = New-Object System.Security.Cryptography.Oid('2.16.840.1.101.3.4.2.1')
    $signer.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
    Write-Output 'FASE:assinando'
    $cms.ComputeSignature($signer, $false)
    if ($cms.Encode().Length -gt 0) { $result.Assinou = $true }
  } catch {
    $result.Erro = $_.Exception.Message
  }
}

$json = [pscustomobject]$result | ConvertTo-Json -Compress -Depth 5
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
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
      // Mata a ÁRVORE de processos (powershell + filhos do CSP/middleware que
      // ele tenha acionado). child.kill() só mata o powershell.exe e pode
      // deixar um diálogo de PIN órfão segurando o handle do token.
      try {
        if (child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
          });
        } else {
          child.kill();
        }
      } catch { /* noop */ }
      cleanup();
      // Fase do script antes do travamento (FASE:store-ok/chave-ok/assinando…)
      // — identifica se parou na leitura do store, na abertura da chave
      // (middleware travado) ou na assinatura em si (PIN/hardware).
      const fase = extrairUltimaFase(stdout);
      const err = new Error(
        'Tempo esgotado aguardando o token/PIN. Verifique se o token está conectado e tente novamente.' +
          (fase ? ` (parou em: ${fase})` : '')
      );
      // Preserva o diagnóstico capturado (hoje era descartado) para os logs —
      // é a única pista quando o middleware trava sem mensagem de erro.
      (err as any).detalhe = { stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 4000) };
      reject(err);
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


// PowerShell: PRÉ-CHECK do certificado A3 — verifica se o thumbprint existe
// no store DESTA máquina, se está dentro da validade e se a chave privada
// ABRE (adquire o contexto do CSP/KSP sem pedir PIN — mesmo teste do
// PS_LISTAR_A3). Token desconectado => chave inacessível em segundos; sem
// isso a assinatura falhava com timeout mudo de 3 minutos. Serve para falhar
// rápido com mensagem clara quando o token/certificado está em outra máquina
// ou o certificado venceu — em vez de travar 3 minutos esperando o PIN.
const PS_PRECHECK_A3 = `
param([string]$Thumbprint, [string]$OutFile)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$result = [ordered]@{ Encontrado = $false; Subject = ''; NotBefore = ''; NotAfter = ''; Store = ''; KeyAcessivel = $false }
$locs = @('CurrentUser', 'LocalMachine')
foreach ($locName in $locs) {
  $loc = [System.Security.Cryptography.X509Certificates.StoreLocation]::$locName
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) {
      if ($c.Thumbprint -ieq $Thumbprint) {
        $result.Encontrado = $true
        $result.Subject = $c.Subject
        $result.NotBefore = $c.NotBefore.ToString('o')
        $result.NotAfter = $c.NotAfter.ToString('o')
        $result.Store = $locName
        # Testa abrir a chave (RSA OU ECDsa, fallback PrivateKey) — só adquire
        # o handle do CSP/KSP, não pede PIN e não assina. Token desconectado
        # ou middleware ausente => $null/false em segundos.
        try {
          $k = $null
          try { $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c) } catch { $k = $null }
          if ($null -eq $k) { try { $k = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($c) } catch { $k = $null } }
          if ($null -eq $k) { try { $k = $c.PrivateKey } catch { $k = $null } }
          if ($null -ne $k) { $result.KeyAcessivel = $true; try { $k.Dispose() } catch {} }
        } catch { $result.KeyAcessivel = $false }
        break
      }
    }
    $store.Close()
  } catch {}
  if ($result.Encontrado) { break }
}
$json = [pscustomobject]$result | ConvertTo-Json -Compress
[System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'OK'
`.trim();

export interface PrecheckA3 {
  status: 'ok' | 'nao-encontrado' | 'expirado' | 'chave-inacessivel' | 'erro';
  /** Mensagem de erro pronta para exibir (quando status != 'ok'). */
  erro?: string;
  validoAte?: string;
}

/**
 * Valida o certificado A3 ANTES de qualquer operação de assinatura: existe no
 * store desta máquina? está válido? a chave privada abre (token conectado)?
 * Retorna erro claro em ~20s no pior caso, em vez do timeout mudo de 3 minutos
 * quando o token está em outra máquina ou desconectado.
 */
export async function precheckCertificadoA3(thumbprint: string): Promise<PrecheckA3> {
  const outFile = path.join(os.tmpdir(), `nexa_precheck_a3_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  try {
    await runPowerShellScriptAsync(PS_PRECHECK_A3, { Thumbprint: thumbprint, OutFile: outFile }, 20000);
    if (!fs.existsSync(outFile)) {
      return { status: 'erro', erro: 'Não foi possível verificar o certificado no Windows. Tente novamente.' };
    }
    const p = JSON.parse(fs.readFileSync(outFile, 'utf8')) as any;
    if (!p?.Encontrado) {
      return { status: 'nao-encontrado', erro: erroCertificadoAusente() };
    }
    const notAfter = p.NotAfter ? String(p.NotAfter) : '';
    const validoAteFmt = notAfter ? notAfter.slice(0, 10).split('-').reverse().join('/') : 'desconhecida';
    if (notAfter && new Date(notAfter).getTime() < Date.now()) {
      return { status: 'expirado', erro: erroCertificadoExpirado(validoAteFmt), validoAte: validoAteFmt };
    }
    // Certificado existe e está válido, mas a chave não abre: token desconectado
    // nesta máquina (sobra do store) ou middleware ausente/travado. Sem isso a
    // assinatura esperava o PIN por 3 minutos e morria em timeout.
    if (p.KeyAcessivel !== true) {
      return { status: 'chave-inacessivel', erro: erroChaveInacessivel(), validoAte: validoAteFmt };
    }
    return { status: 'ok', validoAte: validoAteFmt };
  } catch (e: any) {
    // Timeout/erro na leitura do store → provável middleware travado. Não
    // prossegue para a assinatura (ela travaria da mesma forma).
    logger.warn({ err: e?.message }, 'precheckCertificadoA3: falhou (store ilegível/middleware?)');
    return {
      status: 'erro',
      erro:
        'Não foi possível ler o repositório de certificados do Windows (o middleware do token pode estar travado). ' +
        'Reinicie o computador com o token conectado e tente novamente. ' +
        (e?.message ? `[Erro original: ${e.message}]` : ''),
    };
  } finally {
    try { fs.unlinkSync(outFile); } catch { /* noop */ }
  }
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
      algorithm: String(c?.Algorithm ?? c?.algorithm ?? 'RSA'),
      store: String(c?.Store ?? c?.store ?? 'CurrentUser'),
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

/**
 * Testa a assinatura A3 SEM emitir documento: diagnostica o certificado vinculado
 * (repositório, algoritmo, chave acessível) e, se a chave abrir, assina um payload
 * mínimo via SignedCms — o driver do token pede o PIN, exatamente como na emissão.
 */
async function testarA3(_event: IpcMainInvokeEvent): Promise<ApiResult<TesteA3Resultado>> {
  const ass = getAssinaturaAtiva();
  if (!ass || ass.certificado_tipo !== 'A3' || !ass.certificado_a3_thumbprint) {
    return { ok: false, error: 'Nenhum certificado A3 vinculado. Importe o certificado A3 primeiro.' };
  }
  // Pré-check: falha rápido (~20s no pior caso) com mensagem clara quando o
  // certificado não está nesta máquina ou está vencido — sem esperar o PIN.
  const pre = await precheckCertificadoA3(ass.certificado_a3_thumbprint);
  if (pre.status !== 'ok') {
    return { ok: false, error: pre.erro ?? 'Certificado A3 indisponível nesta máquina.' };
  }
  const outFile = path.join(os.tmpdir(), `nexa_teste_a3_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  try {
    await runPowerShellScriptAsync(
      PS_TESTAR_A3,
      { Thumbprint: ass.certificado_a3_thumbprint, OutFile: outFile },
      180000
    );
    if (!fs.existsSync(outFile)) {
      return { ok: false, error: 'O teste não produziu resultado. Tente novamente.' };
    }
    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')) as any;
    const resultado: TesteA3Resultado = {
      encontrado: Boolean(parsed?.Encontrado ?? false),
      certificados: (Array.isArray(parsed?.Certs) ? parsed.Certs : (parsed?.Certs ? [parsed.Certs] : [])).map((c: any) => ({
        store: String(c?.Store ?? 'CurrentUser'),
        algorithm: String(c?.Algorithm ?? 'RSA'),
        keyAcessivel: Boolean(c?.KeyAcessivel ?? false),
      })),
      assinou: Boolean(parsed?.Assinou ?? false),
      erro: parsed?.Erro ? String(parsed.Erro) : undefined,
    };
    logger.info({ resultado }, 'testarA3: resultado do teste de assinatura A3');
    return { ok: true, data: resultado };
  } catch (e: any) {
    const msg = (e?.stderr?.toString?.() ?? e?.message ?? '').toString();
    logger.error({ err: msg, detalhe: e?.detalhe }, 'testarA3: falha ao executar teste de assinatura A3');
    return { ok: false, error: traduzirErroA3(msg) };
  } finally {
    try { fs.unlinkSync(outFile); } catch { /* noop */ }
  }
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
  // Pré-check: certificado presente nesta máquina e dentro da validade.
  const pre = await precheckCertificadoA3(thumbprint);
  if (pre.status !== 'ok') {
    return { ok: false, error: pre.erro ?? 'Certificado A3 indisponível nesta máquina.' };
  }
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const inFile = path.join(os.tmpdir(), `nexa_a3_in_${id}.xml`);
  const outFile = path.join(os.tmpdir(), `nexa_a3_out_${id}.xml`);
  fs.writeFileSync(inFile, xmlContent, 'utf8');
  try {
    await runPowerShellScriptAsync(PS_ASSINAR_A3, { Thumbprint: thumbprint, InFile: inFile, OutFile: outFile }, 180000);
    if (!fs.existsSync(outFile)) {
      return { ok: false, error: 'Falha ao assinar com o token. Saída não gerada.' };
    }
    const signed = fs.readFileSync(outFile, 'utf8');
    return { ok: true, xml: signed };
  } catch (e: any) {
    const msg = (e?.stderr?.toString?.() ?? e?.message ?? '').toString();
    logger.error({ err: msg, detalhe: e?.detalhe }, 'assinarXmlA3: falha ao assinar XML com o token A3');
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
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_TESTAR_A3, requerAuth(testarA3));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_ASSINAR_XML, requerAuth(assinarXmlHandler));
  ipcMain.handle(IPC_CHANNELS.ASSINATURA_PREVIEW_IMAGEM, requerAuth(previewImagem));
}
