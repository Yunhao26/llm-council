param(
  [int]$OrchestratorPort = 8001,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"

Write-Host "LLM Council - Verify (local)" -ForegroundColor Cyan
Write-Host ""

function HttpCode {
  param([Parameter(Mandatory=$true)][string]$Url)
  try {
    $code = curl.exe -s -o NUL -w "%{http_code}" $Url
    return "$code"
  } catch {
    return "000"
  }
}

$orchRoot = "http://127.0.0.1:$OrchestratorPort/"
$orchHealth = "http://127.0.0.1:$OrchestratorPort/api/workers/health"
# Vite may bind to localhost/IPv6 on Windows, so verify via localhost (not 127.0.0.1).
$front = "http://localhost:$FrontendPort/"

Write-Host "Orchestrator root:  $orchRoot -> $(HttpCode $orchRoot)" -ForegroundColor Gray
Write-Host "Workers health:     $orchHealth -> $(HttpCode $orchHealth)" -ForegroundColor Gray
Write-Host "Frontend:           $front -> $(HttpCode $front)" -ForegroundColor Gray
Write-Host ""
Write-Host "Tip: for detailed worker status, open: $orchHealth" -ForegroundColor Gray

