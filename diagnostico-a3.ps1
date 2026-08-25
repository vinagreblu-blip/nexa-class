# ============================================================
# NEXA CLASS - Diagnostico do certificado A3 (rodar FORA do app)
# ============================================================
# Uso: copie este arquivo para a maquina com o token e execute no PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\diagnostico-a3.ps1
#
# O que faz:
#   1. Lista certificados com chave privada no Windows (CurrentUser + LocalMachine)
#   2. Testa se a chave privada ABRE (sem pedir PIN)
#   3. Assina um payload minimo (SignedCms) - o driver do token pede o PIN
#      FIQUE DE OLHO na tela/barra de tarefas durante esta fase!
#
# Interpretacao:
#   - PIN apareceu e assinou  -> token/middleware OK (problema esta no contexto do app)
#   - Nenhum PIN apareceu e travou em "assinando" -> middleware travado:
#       reinicie o PC com o token conectado; verifique o servico do middleware
#       (ex.: SafeNet Authentication Client) e o icone perto do relogio
#   - "chave inacessivel" -> token desconectado ou middleware ausente
# ============================================================
param([string]$Thumbprint)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Add-Type -AssemblyName System.Security

Write-Host '=== 1) Listando certificados com chave privada ===' -ForegroundColor Cyan
$certs = @()
foreach ($locName in @('CurrentUser','LocalMachine')) {
  $loc = [System.Security.Cryptography.X509Certificates.StoreLocation]::$locName
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) {
      if (-not $c.HasPrivateKey) { continue }
      $k = $null
      try { $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($c) } catch { $k = $null }
      if ($null -eq $k) { try { $k = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($c) } catch { $k = $null } }
      if ($null -eq $k) { try { $k = $c.PrivateKey } catch { $k = $null } }
      $chaveOk = $null -ne $k
      if ($chaveOk) { try { $k.Dispose() } catch {} }
      $certs += [pscustomobject]@{
        Thumbprint = $c.Thumbprint
        Subject    = ($c.Subject -replace '.*CN=([^,]+).*', '$1')
        ValidoAte  = $c.NotAfter.ToString('dd/MM/yyyy')
        Vencido    = ($c.NotAfter -lt (Get-Date))
        ChaveOK    = $chaveOk
        Store      = $locName
      }
    }
    $store.Close()
  } catch { Write-Host "  (store $locName ilegivel: $($_.Exception.Message))" -ForegroundColor DarkYellow }
}
if ($certs.Count -eq 0) {
  Write-Host 'NENHUM certificado com chave privada encontrado. Middleware instalado? Token conectado?' -ForegroundColor Red
  exit 1
}
$certs | Format-Table Subject, ValidoAte, Vencido, ChaveOK, Store -AutoSize

# Seleciona o certificado a testar
$alvo = $null
if ($Thumbprint) {
  $alvo = $certs | Where-Object { $_.Thumbprint -ieq $Thumbprint } | Select-Object -First 1
  if (-not $alvo) { Write-Host 'Thumbprint nao encontrado.' -ForegroundColor Red; exit 1 }
} else {
  $validos = @($certs | Where-Object { -not $_.Vencido -and $_.ChaveOK })
  if ($validos.Count -eq 1) { $alvo = $validos[0] }
  elseif ($validos.Count -gt 1) {
    Write-Host 'Varios certificados validos - escolha pelo numero:' -ForegroundColor Yellow
    for ($i = 0; $i -lt $validos.Count; $i++) {
      Write-Host ('  [{0}] {1} (valido ate {2})' -f $i, $validos[$i].Subject, $validos[$i].ValidoAte)
    }
    $idx = Read-Host 'Numero'
    $alvo = $validos[[int]$idx]
  } else {
    Write-Host 'Nenhum certificado valido com chave acessivel (vencidos ou chave inacessivel).' -ForegroundColor Red
    exit 1
  }
}
Write-Host ('Certificado em teste: {0} ({1}, valido ate {2})' -f $alvo.Subject, $alvo.Thumbprint, $alvo.ValidoAte) -ForegroundColor Green

# Reabre o certificado original para assinar
$cert = $null
foreach ($locName in @('CurrentUser','LocalMachine')) {
  $loc = [System.Security.Cryptography.X509Certificates.StoreLocation]::$locName
  try {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('My', $loc)
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($c in $store.Certificates) { if ($c.Thumbprint -ieq $alvo.Thumbprint) { $cert = $c; break } }
    $store.Close()
  } catch {}
  if ($cert) { break }
}
if (-not $cert) { Write-Host 'Certificado sumiu do store na segunda leitura - middleware instavel.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '=== 2) Assinando payload de teste (procure a janela do PIN AGORA!) ===' -ForegroundColor Cyan
$data = [System.Text.Encoding]::UTF8.GetBytes('nexa-diagnostico-a3')
$content = New-Object System.Security.Cryptography.Pkcs.ContentInfo -ArgumentList (,[byte[]]$data)
$cms = New-Object System.Security.Cryptography.Pkcs.SignedCms -ArgumentList $content, $true
$signer = New-Object System.Security.Cryptography.Pkcs.CmsSigner($cert)
$signer.DigestAlgorithm = New-Object System.Security.Cryptography.Oid('2.16.840.1.101.3.4.2.1')
$signer.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $cms.ComputeSignature($signer, $false)
  $sw.Stop()
  Write-Host ('ASSINADO COM SUCESSO em {0}ms ({1} bytes) - token e middleware OK.' -f $sw.ElapsedMilliseconds, $cms.Encode().Length) -ForegroundColor Green
  Write-Host 'Se o APP ainda falha com timeout: o problema e o contexto do app -> reporte ao suporte.' -ForegroundColor Yellow
} catch {
  $sw.Stop()
  Write-Host ('FALHOU em {0}ms: {1}' -f $sw.ElapsedMilliseconds, $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Erro do PIN (cancelado/incorreto/bloqueado) = token OK, refaca informando o PIN correto.'
}
