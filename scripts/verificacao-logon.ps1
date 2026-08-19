# Auto-start do servico de verificacao web NEXA CLASS + tunel Cloudflare.
# Executado pela tarefa agendada "NEXA Verificacao Web" no logon do Windows.
#
# O que faz (idempotente - pode rodar quantas vezes quiser):
#   1. Sobe o servico verificacao-web (porta 3001) se nao estiver rodando
#   2. Sobe o tunel cloudflared se nao estiver rodando
#   3. Extrai a URL publica do log do tunel e valida pela internet
#   4. Se a URL mudou, atualiza VERIFICACAO_BASE_URL do usuario (setx) e
#      notifica o Explorer (WM_SETTINGCHANGE) para novos processos enxergarem
#   5. Garante VERIFICACAO_API_KEY do usuario = deploy-keys.txt
#
# Log: verificacao-auto.log (raiz do repo)
$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot
$logFile = Join-Path $repoRoot 'verificacao-auto.log'
function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Path $logFile }

Log '=== Inicio verificacao-logon.ps1 ==='

# --- API key ---
$apiKey = $null
$dk = Join-Path $repoRoot 'deploy-keys.txt'
if (Test-Path $dk) {
  $m = Select-String -Path $dk -Pattern '^[a-f0-9]{64}$' | Select-Object -First 1
  if ($m) { $apiKey = $m.Matches[0].Value }
}
if (-not $apiKey) { Log 'ERRO: API key nao encontrada em deploy-keys.txt'; exit 1 }

# --- 1) Servico web na porta 3001 ---
$servicoOk = $false
try {
  $h = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 3
  if ($h.StatusCode -eq 200) { $servicoOk = $true }
} catch {}
if (-not $servicoOk) {
  if (-not (Test-Path (Join-Path $repoRoot 'verificacao-web\dist\server\index.js'))) {
    Log 'ERRO: build ausente (verificacao-web\dist). Rode: npm run web:build'
    exit 1
  }
  $env:API_KEY = $apiKey
  $env:NODE_ENV = 'production'
  $env:PORT = '3001'
  $env:INSTITUICAO = 'NEXA CLASS - Network for Education and Academic Excellence Class'
  Start-Process -FilePath 'node' `
    -ArgumentList 'verificacao-web\dist\server\index.js' `
    -WorkingDirectory $repoRoot -WindowStyle Hidden `
    -RedirectStandardOutput 'web-prod-out.txt' -RedirectStandardError 'web-prod-err.txt'
  $ok = $false
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 2
    try {
      $h = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 3
      if ($h.StatusCode -eq 200) { $ok = $true; break }
    } catch {}
  }
  if ($ok) { Log 'Servico web iniciado (porta 3001)' } else { Log 'ERRO: servico web nao respondeu apos 30s'; exit 1 }
} else {
  Log 'Servico web ja rodando (porta 3001)'
}

# --- 2) Tunel cloudflared ---
$cfd = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
if ($cfd) {
  Log "cloudflared ja rodando (PID $($cfd[0].Id))"
} else {
  $cfdPath = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
  if (-not (Test-Path $cfdPath)) { $cfdPath = 'C:\Program Files\cloudflared\cloudflared.exe' }
  if (-not (Test-Path $cfdPath)) { Log 'ERRO: cloudflared nao instalado'; exit 1 }
  # logs antigos removidos para nao extrair URL de execucao anterior
  Remove-Item 'tunnel-log.txt', 'tunnel-out.txt', 'tunnel-err.txt' -ErrorAction SilentlyContinue
  Start-Process -FilePath $cfdPath `
    -ArgumentList 'tunnel', '--url', 'http://localhost:3001', '--logfile', 'tunnel-log.txt' `
    -WorkingDirectory $repoRoot -WindowStyle Hidden `
    -RedirectStandardOutput 'tunnel-out.txt' -RedirectStandardError 'tunnel-err.txt'
  Log 'cloudflared iniciado'
}

# --- 3) Extrai URL publica (ate 60s) ---
$url = $null
for ($i = 0; $i -lt 30; $i++) {
  foreach ($lf in @('tunnel-log.txt', 'tunnel-err.txt')) {
    if (Test-Path $lf) {
      $m = Select-String -Path $lf -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value; break }
    }
  }
  if ($url) { break }
  Start-Sleep -Seconds 2
}
if (-not $url) { Log 'ERRO: URL do tunel nao encontrada em 60s'; exit 1 }
$url | Set-Content 'tunnel-url-atual.txt'
try {
  $h = Invoke-WebRequest -Uri "$url/health" -UseBasicParsing -TimeoutSec 30
  Log "URL validada pela internet: $url (status $($h.StatusCode))"
} catch {
  Log "AVISO: URL nao validada ($($_.Exception.Message)): $url"
}

# --- 4) Ambiente do usuario (HKCU) ---
$atual = [Environment]::GetEnvironmentVariable('VERIFICACAO_BASE_URL', 'User')
if ($atual -ne $url) {
  setx VERIFICACAO_BASE_URL "$url" | Out-Null
  Log "VERIFICACAO_BASE_URL atualizada: '$atual' -> '$url'"
} else {
  Log 'VERIFICACAO_BASE_URL ja em dia'
}
$keyAtual = [Environment]::GetEnvironmentVariable('VERIFICACAO_API_KEY', 'User')
if ($keyAtual -ne $apiKey) {
  setx VERIFICACAO_API_KEY "$apiKey" | Out-Null
  Log 'VERIFICACAO_API_KEY atualizada (usuario)'
} else {
  Log 'VERIFICACAO_API_KEY ja em dia'
}

# --- 5) Broadcast p/ Explorer propagar env para processos novos ---
try {
  Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);'
  $res = [UIntPtr]::Zero
  [Win32.NativeMethods]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$res) | Out-Null
  Log 'Broadcast WM_SETTINGCHANGE enviado'
} catch {
  Log "AVISO: broadcast falhou ($($_.Exception.Message))"
}

Log 'Concluido. Abra o NEXA CLASS normalmente (aguarde ~30s apos o logon).'
