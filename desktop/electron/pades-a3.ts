import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @signpdf/utils é CommonJS — importamos o caminho da base Signer.
import { Signer } from '@signpdf/utils';
import { runPowerShellScriptAsync, precheckCertificadoA3 } from './ipc/assinatura';
import { logger } from './utils/logger';

/**
 * Signer PAdES para certificado A3 (token USB / SmartCard).
 *
 * O A3 não expõe a chave privada — ela fica no hardware. Por isso, em vez de
 * assinar com a chave extraída (como faz o P12Signer do A1), geramos o CMS
 * completo no .NET (`System.Security.Cryptography.Pkcs.SignedCms`) usando o
 * certificado do Windows Certificate Store. O ComputeSignature() aciona o
 * driver do token, que pede o PIN ao usuário.
 *
 * O `@signpdf/signpdf` cuida de TODO o trabalho de PDF (ByteRange, placeholder,
 * embedding do Contents) e chama `signer.sign(pdfBuffer)` recebendo exatamente
 * os bytes cobertos pela assinatura. Aqui só precisamos devolver o CMS detached.
 */

// PowerShell: gera um CMS/PKCS#7 detached (SHA-256) sobre os bytes recebidos,
// assinando com o certificado do token (pelo thumbprint).
const PS_CMS_A3 = `
param([string]$Thumbprint, [string]$DataFile, [string]$OutFile)
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
$rsaKey = $null
foreach ($cand in $candidatos) {
  # Abre a chave privada (RSA OU ECDsa — certificados ICP-Brasil novos podem ser ECC).
  # A chave so e um gate de acessibilidade: o CmsSigner abaixo assina com o cert.
  try {
    $k = $null
    try { $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cand) } catch { $k = $null }
    if ($null -eq $k) { try { $k = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($cand) } catch { $k = $null } }
    if ($null -eq $k) { $k = $cand.PrivateKey }
    if ($null -ne $k) { $cert = $cand; $rsaKey = $k; break }
  } catch {}
}
if ($null -eq $rsaKey) { throw 'Chave privada nao acessivel: o certificado foi encontrado, mas o Windows nao conseguiu abrir a chave do token. Conecte o token/SmartCard e instale o middleware do fabricante (Safenet, Pronova, Gemalto, Watchdata...).' }
Write-Output 'FASE:chave-ok'

$data = [System.IO.File]::ReadAllBytes($DataFile)
$content = New-Object System.Security.Cryptography.Pkcs.ContentInfo -ArgumentList (,[byte[]]$data)
# detached = true => CMS sem o eContent (o que o PAdES/adbe.pkcs7.detached exige).
$cms = New-Object System.Security.Cryptography.Pkcs.SignedCms -ArgumentList $content, $true

$signer = New-Object System.Security.Cryptography.Pkcs.CmsSigner($cert)
$signer.DigestAlgorithm = New-Object System.Security.Cryptography.Oid('2.16.840.1.101.3.4.2.1') # sha256
$signer.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly

# ComputeSignature invoca o token -> PIN pedido pelo driver do fabricante.
Write-Output 'FASE:assinando'
$cms.ComputeSignature($signer, $false)
Write-Output 'FASE:assinado'
$encoded = $cms.Encode()
[System.IO.File]::WriteAllBytes($OutFile, $encoded)
Write-Output 'OK'
`.trim();

export interface SignerA3Options {
  /** SHA-1 thumbprint do certificado no Windows Certificate Store (CurrentUser\My). */
  thumbprint: string;
}

export class SignerA3 extends Signer {
  readonly thumbprint: string;

  constructor({ thumbprint }: SignerA3Options) {
    super();
    if (!thumbprint || !/^[0-9a-fA-F]+$/.test(thumbprint)) {
      throw new Error('Thumbprint A3 inválido');
    }
    this.thumbprint = thumbprint.toUpperCase();
  }

  /**
   * Recebe os bytes do PDF cobertos pela assinatura e devolve o CMS detached (DER).
   * O .NET calcula o messageDigest (SHA-256) e assina via token.
   */
  async sign(pdfBuffer: Buffer): Promise<Buffer> {
    // Pré-check: falha rápido com mensagem clara se o certificado não está
    // nesta máquina (token em outra máquina) ou está vencido — em vez do
    // timeout mudo de 3 minutos no meio da emissão do documento.
    const pre = await precheckCertificadoA3(this.thumbprint);
    if (pre.status !== 'ok') {
      throw new Error(pre.erro ?? 'Certificado A3 indisponível nesta máquina.');
    }
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const dataFile = path.join(os.tmpdir(), `nexa_pades_in_${id}.bin`);
    const outFile = path.join(os.tmpdir(), `nexa_pades_out_${id}.der`);
    fs.writeFileSync(dataFile, pdfBuffer);
    try {
      await runPowerShellScriptAsync(
        PS_CMS_A3,
        { Thumbprint: this.thumbprint, DataFile: dataFile, OutFile: outFile },
        180000
      );
      if (!fs.existsSync(outFile)) {
        throw new Error('O token não gerou a assinatura. Saída não produzida.');
      }
      const cms = fs.readFileSync(outFile);
      if (!cms || cms.length === 0) {
        throw new Error('O token não gerou a assinatura. CMS vazio.');
      }
      return cms;
    } catch (e: any) {
      const msg = (e?.stderr?.toString?.() ?? e?.message ?? '').toString();
      logger.error({ err: msg, detalhe: e?.detalhe }, 'SignerA3: falha ao gerar CMS com o token A3');
      throw e;
    } finally {
      try { fs.unlinkSync(dataFile); } catch { /* noop */ }
      try { fs.unlinkSync(outFile); } catch { /* noop */ }
    }
  }
}
