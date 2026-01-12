param(
  [string]$OllamaModel = "mistral:7b",
  [int]$OrchestratorPort = 8001,
  [int]$FrontendPort = 5173,
  [int]$CouncilPortA = 8002,
  [int]$CouncilPortB = 8004,
  [int]$CouncilPortC = 8005,
  [int]$CouncilPortD = 8006,
  [int]$ChairmanPort = 8003,
  [switch]$DryRun,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
Set-Location $repoRoot

$logDir = Join-Path $repoRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Encode-PowerShellCommand {
  param([Parameter(Mandatory=$true)][string]$Command)
  $bytes = [System.Text.Encoding]::Unicode.GetBytes($Command)
  return [Convert]::ToBase64String($bytes)
}

function Start-LoggedProcess {
  param(
    [Parameter(Mandatory=$true)][string]$Name,
    [Parameter(Mandatory=$true)][string]$FilePath,
    [Parameter(Mandatory=$true)][string[]]$ArgumentList,
    [Parameter(Mandatory=$true)][string]$WorkingDirectory
  )

  $logPathOut = Join-Path $logDir "$Name.out.log"
  $logPathErr = Join-Path $logDir "$Name.err.log"
  Write-Host "Starting $Name ..." -ForegroundColor Green

  if ($DryRun) {
    Write-Host "DRY RUN: $FilePath $($ArgumentList -join ' ')" -ForegroundColor Gray
    Write-Host "  stdout: $logPathOut" -ForegroundColor Gray
    Write-Host "  stderr: $logPathErr" -ForegroundColor Gray
    return
  }

  Start-Process `
    -FilePath $FilePath `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $WorkingDirectory `
    -RedirectStandardOutput $logPathOut `
    -RedirectStandardError $logPathErr | Out-Null

  Write-Host "  stdout: $logPathOut" -ForegroundColor Gray
  Write-Host "  stderr: $logPathErr" -ForegroundColor Gray
}

Write-Host "LLM Council - Local Demo Start (single PC)" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot" -ForegroundColor Gray
Write-Host "Ollama model for all workers: $OllamaModel" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: run .\\demo_stop.ps1 first if ports are already in use." -ForegroundColor Yellow
Write-Host ""

# Workers (Council A/B/C/D + Chairman)
$workerA = @'
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-A (localhost)"
$env:OLLAMA_MODEL="__OLLAMA_MODEL__"
$env:WORKER_HOST="0.0.0.0"
$env:WORKER_PORT="__WORKER_PORT__"
uv run python -m backend.worker
'@
$workerA = $workerA.Replace("__OLLAMA_MODEL__", "$OllamaModel").Replace("__WORKER_PORT__", "$CouncilPortA")
$workerAEnc = Encode-PowerShellCommand -Command $workerA

$workerB = @'
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-B (localhost)"
$env:OLLAMA_MODEL="__OLLAMA_MODEL__"
$env:WORKER_HOST="0.0.0.0"
$env:WORKER_PORT="__WORKER_PORT__"
uv run python -m backend.worker
'@
$workerB = $workerB.Replace("__OLLAMA_MODEL__", "$OllamaModel").Replace("__WORKER_PORT__", "$CouncilPortB")
$workerBEnc = Encode-PowerShellCommand -Command $workerB

$workerC = @'
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-C (localhost)"
$env:OLLAMA_MODEL="__OLLAMA_MODEL__"
$env:WORKER_HOST="0.0.0.0"
$env:WORKER_PORT="__WORKER_PORT__"
uv run python -m backend.worker
'@
$workerC = $workerC.Replace("__OLLAMA_MODEL__", "$OllamaModel").Replace("__WORKER_PORT__", "$CouncilPortC")
$workerCEnc = Encode-PowerShellCommand -Command $workerC

$workerD = @'
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-D (localhost)"
$env:OLLAMA_MODEL="__OLLAMA_MODEL__"
$env:WORKER_HOST="0.0.0.0"
$env:WORKER_PORT="__WORKER_PORT__"
uv run python -m backend.worker
'@
$workerD = $workerD.Replace("__OLLAMA_MODEL__", "$OllamaModel").Replace("__WORKER_PORT__", "$CouncilPortD")
$workerDEnc = Encode-PowerShellCommand -Command $workerD

$chairman = @'
$env:WORKER_ROLE="chairman"
$env:WORKER_NAME="Chairman (localhost)"
$env:OLLAMA_MODEL="__OLLAMA_MODEL__"
$env:WORKER_HOST="0.0.0.0"
$env:WORKER_PORT="__WORKER_PORT__"
uv run python -m backend.worker
'@
$chairman = $chairman.Replace("__OLLAMA_MODEL__", "$OllamaModel").Replace("__WORKER_PORT__", "$ChairmanPort")
$chairmanEnc = Encode-PowerShellCommand -Command $chairman

Start-LoggedProcess -Name "worker-council-a-$CouncilPortA" -FilePath "powershell" -ArgumentList @(
  "-NoProfile","-ExecutionPolicy","Bypass","-EncodedCommand",$workerAEnc
) -WorkingDirectory $repoRoot

Start-LoggedProcess -Name "worker-council-b-$CouncilPortB" -FilePath "powershell" -ArgumentList @(
  "-NoProfile","-ExecutionPolicy","Bypass","-EncodedCommand",$workerBEnc
) -WorkingDirectory $repoRoot

Start-LoggedProcess -Name "worker-council-c-$CouncilPortC" -FilePath "powershell" -ArgumentList @(
  "-NoProfile","-ExecutionPolicy","Bypass","-EncodedCommand",$workerCEnc
) -WorkingDirectory $repoRoot

Start-LoggedProcess -Name "worker-council-d-$CouncilPortD" -FilePath "powershell" -ArgumentList @(
  "-NoProfile","-ExecutionPolicy","Bypass","-EncodedCommand",$workerDEnc
) -WorkingDirectory $repoRoot

Start-LoggedProcess -Name "worker-chairman-$ChairmanPort" -FilePath "powershell" -ArgumentList @(
  "-NoProfile","-ExecutionPolicy","Bypass","-EncodedCommand",$chairmanEnc
) -WorkingDirectory $repoRoot

# Orchestrator
Start-LoggedProcess -Name "orchestrator-$OrchestratorPort" -FilePath "uv" -ArgumentList @(
  "run","python","-m","backend.main"
) -WorkingDirectory $repoRoot

# Frontend (Vite)
$frontendDir = Join-Path $repoRoot "frontend"
$frontendCmd = @'
npm run dev -- --port __FRONT_PORT__
'@
$frontendCmd = $frontendCmd.Replace("__FRONT_PORT__", "$FrontendPort")
$frontendEnc = Encode-PowerShellCommand -Command $frontendCmd

Start-LoggedProcess -Name "frontend-$FrontendPort" -FilePath "powershell" -ArgumentList @(
  "-NoProfile","-ExecutionPolicy","Bypass","-EncodedCommand",$frontendEnc
) -WorkingDirectory $frontendDir

Write-Host ""
Write-Host "Started. Quick verify commands:" -ForegroundColor Green
Write-Host "  - Orchestrator health:  curl.exe http://127.0.0.1:$OrchestratorPort/" -ForegroundColor Gray
Write-Host "  - Workers health:       curl.exe http://127.0.0.1:$OrchestratorPort/api/workers/health" -ForegroundColor Gray
Write-Host "  - Open UI:              http://localhost:$FrontendPort/" -ForegroundColor Gray
Write-Host ""
Write-Host "Logs folder: $logDir" -ForegroundColor Gray

if (-not $DryRun -and -not $NoBrowser) {
  Start-Sleep -Seconds 1
  Start-Process "http://localhost:$FrontendPort/" | Out-Null
}

