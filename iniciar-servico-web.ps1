# Inicia o serviço web NEXA CLASS + túnel público Cloudflare.
#
# Uso: PowerShell -> .\iniciar-servico-web.ps1
#
# O que faz:
#   1. Sobe o serviço verificacao-web na porta 3001 (modo produção)
#   2. Sobe o túnel Cloudflare → gera URL .trycloudflare.com pública
#   3. Mostra a URL na tela + salva em tunnel-url-atual.txt
#
# Quando usar:
#   - Após reiniciar o PC
#   - Quando a URL parar de funcionar (Cloudflare quick tunnels caem raramente)
#   - Quando precisar atualizar a URL no app desktop
#
# IMPORTANTE: a URL .trycloudflare.com muda toda vez que o túnel reinicia.
# Depois de rodar este script, atualize VERIFICACAO_BASE_URL nas 6 máquinas.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host " NEXA CLASS — Servico Web + Tunel" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# API key forte fixa — mesma em todas as 6 máquinas e no serviço web.
# Gerada uma única vez. NÃO COMMITAR (já está no .gitignore via deploy-keys.txt).
if (-not (Test-Path "deploy-keys.txt")) {
  Write-Host "[!] deploy-keys.txt nao encontrado. Gerando..." -ForegroundColor Yellow
  node scripts\gerar-deploy-keys.js | Out-Null
}
$apiKey = (Select-String -Path "deploy-keys.txt" -Pattern "^[a-f0-9]{64}$").Matches[0].Value
if (-not $apiKey) {
  Write-Host "[ERRO] API key invalida em deploy-keys.txt" -ForegroundColor Red
  exit 1
}

# 1) Verifica se serviço web já está rodando na porta 3001
$servicoRodando = $false
try {
  $h = Invoke-WebRequest -Uri "http://127.0.0.1:3001/health" -UseBasicParsing -TimeoutSec 3
  if ($h.StatusCode -eq 200) { $servicoRodando = $true }
} catch {}

if ($servicoRodando) {
  Write-Host "[ok] Servico web ja esta rodando na porta 3001" -ForegroundColor Green
} else {
  Write-Host "[..] Iniciando servico web (porta 3001)..." -ForegroundColor Yellow

  if (-not (Test-Path "verificacao-web\dist\server\index.js")) {
    Write-Host "    Build nao encontrado. Rodando npm run web:build..." -ForegroundColor Gray
    npm run web:build 2>&1 | Out-Null
  }

  $env:API_KEY = $apiKey
  $env:NODE_ENV = "production"
  $env:PORT = "3001"
  $env:INSTITUICAO = "NEXA CLASS - Network for Education and Academic Excellence Class"

  Start-Process -FilePath "node" `
    -ArgumentList "verificacao-web\dist\server\index.js" `
    -WorkingDirectory $repoRoot `
    -NoNewWindow `
    -RedirectStandardOutput "web-prod-out.txt" `
    -RedirectStandardError "web-prod-err.txt"

  Start-Sleep -Seconds 5

  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:3001/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "[ok] Servico web rodando: $($h.Content)" -ForegroundColor Green
  } catch {
    Write-Host "[ERRO] Servico web nao respondeu. Veja web-prod-err.txt" -ForegroundColor Red
    exit 1
  }
}

# 2) Verifica se cloudflared já está rodando
$cfdRodando = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
if ($cfdRodando) {
  Write-Host "[ok] cloudflared ja esta rodando (PID $($cfdRodando.Id))" -ForegroundColor Green
  Write-Host "    (nao vai gerar nova URL)" -ForegroundColor Gray
} else {
  Write-Host "[..] Iniciando Cloudflare Tunnel..." -ForegroundColor Yellow
  $cfdPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (-not (Test-Path $cfdPath)) { $cfdPath = "C:\Program Files\cloudflared\cloudflared.exe" }

  Start-Process -FilePath $cfdPath `
    -ArgumentList "tunnel", "--url", "http://localhost:3001", "--logfile", "tunnel-log.txt" `
    -NoNewWindow `
    -RedirectStandardOutput "tunnel-out.txt" `
    -RedirectStandardError "tunnel-err.txt"

  Write-Host "    Aguardando tunel estabelecer (20s)..." -ForegroundColor Gray
  Start-Sleep -Seconds 20
}

# 3) Captura URL pública do log mais recente
$url = $null
foreach ($logFile in @("tunnel-log.txt", "tunnel-err.txt")) {
  if (Test-Path $logFile) {
    $m = Select-String -Path $logFile -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -Last 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
}

if ($url) {
  $url | Set-Content "tunnel-url-atual.txt"
  Write-Host ""
  Write-Host "===============================================" -ForegroundColor Green
  Write-Host " SERVICO NO AR" -ForegroundColor Green
  Write-Host "===============================================" -ForegroundColor Green
  Write-Host ""
  Write-Host " URL publica: " -NoNewline -ForegroundColor White
  Write-Host $url -ForegroundColor Cyan
  Write-Host ""
  Write-Host " Em CADA maquina desktop, rode como admin:" -ForegroundColor Yellow
  Write-Host "   setx VERIFICACAO_BASE_URL `"$url`" /M" -ForegroundColor White
  Write-Host "   (depois reinicie o PC)" -ForegroundColor Gray
  Write-Host ""
  Write-Host " API key (ja configurada no servico): " -NoNewline -ForegroundColor Yellow
  Write-Host $apiKey -ForegroundColor Gray
  Write-Host ""
  Write-Host " Teste rapido (cole no navegador):" -ForegroundColor Yellow
  Write-Host "   $url/health" -ForegroundColor White
  Write-Host ""
  Write-Host " URL salva em: tunnel-url-atual.txt" -ForegroundColor Gray
} else {
  Write-Host "[ERRO] URL nao encontrada nos logs. Veja tunnel-log.txt" -ForegroundColor Red
  exit 1
}
