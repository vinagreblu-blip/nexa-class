import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @signpdf/utils é CommonJS — importamos o caminho da base Signer.
import { Signer } from '@signpdf/utils';
import { runPowerShellScriptAsync } from './ipc/assinatura';

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

# Busca o cert por thumbprint via X509Store (sem o provider Cert:, que trava em token).
$cert = $null
$locs = @(([System.Security.Cryptography.X509Certificates.StoreLocation]::CurrentUser), ([System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine))
foreach ($loc in $locs) {
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) { if ($c.Thumbprint -ieq $Thumbprint) { $cert = $c; break } }
    $store.Close()
  } catch {}
  if ($null -ne $cert) { break }
}
if ($null -eq $cert) { throw 'Certificado nao encontrado no repositorio do Windows (CurrentUser/LocalMachine).' }
$rsaKey = $cert.GetRSAPrivateKey()
if ($null -eq $rsaKey) { throw 'Chave privada nao acessivel. Conecte o token/SmartCard e tente novamente.' }

$data = [System.IO.File]::ReadAllBytes($DataFile)
$content = New-Object System.Security.Cryptography.Pkcs.ContentInfo -ArgumentList (,[byte[]]$data)
# detached = true => CMS sem o eContent (o que o PAdES/adbe.pkcs7.detached exige).
$cms = New-Object System.Security.Cryptography.Pkcs.SignedCms -ArgumentList $content, $true

$signer = New-Object System.Security.Cryptography.Pkcs.CmsSigner($cert)
$signer.DigestAlgorithm = New-Object System.Security.Cryptography.Oid('2.16.840.1.101.3.4.2.1') # sha256
$signer.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly

# ComputeSignature invoca o token -> PIN pedido pelo driver do fabricante.
$cms.ComputeSignature($signer, $false)
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
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const dataFile = path.join(os.tmpdir(), `nexa_pades_in_${id}.bin`);
    const outFile = path.join(os.tmpdir(), `nexa_pades_out_${id}.der`);
    fs.writeFileSync(dataFile, pdfBuffer);
    try {
      await runPowerShellScriptAsync(
        PS_CMS_A3,
        { Thumbprint: this.thumbprint, DataFile: dataFile, OutFile: outFile },
        120000
      );
      if (!fs.existsSync(outFile)) {
        throw new Error('O token não gerou a assinatura. Saída não produzida.');
      }
      const cms = fs.readFileSync(outFile);
      if (!cms || cms.length === 0) {
        throw new Error('O token não gerou a assinatura. CMS vazio.');
      }
      return cms;
    } finally {
      try { fs.unlinkSync(dataFile); } catch { /* noop */ }
      try { fs.unlinkSync(outFile); } catch { /* noop */ }
    }
  }
}
