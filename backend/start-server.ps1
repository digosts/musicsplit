# Sobe o servidor de separação e um túnel HTTPS gratuito (Cloudflare) para o app na Vercel acessar.
# Uso:  .\start-server.ps1            (sem senha)
#       .\start-server.ps1 -Token "minha-senha-secreta"
param([string]$Token = $env:API_TOKEN)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$env:API_TOKEN = $Token

$server = Start-Process -PassThru -NoNewWindow ".\.venv\Scripts\python.exe" "main.py"
Write-Host "Servidor rodando em http://localhost:8000" -ForegroundColor Green

if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    Write-Host "Abrindo túnel... copie o endereço https://....trycloudflare.com e cole em Ajustes no app." -ForegroundColor Cyan
    try { cloudflared tunnel --url http://localhost:8000 } finally { Stop-Process -Id $server.Id -ErrorAction SilentlyContinue }
} else {
    Write-Host "cloudflared não encontrado. Instale com:  winget install Cloudflare.cloudflared" -ForegroundColor Yellow
    Wait-Process -Id $server.Id
}
