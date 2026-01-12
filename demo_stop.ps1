param(
  [int[]]$Ports = @(5173, 8001, 8002, 8003, 8004, 8005, 8006),
  [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

Write-Host "LLM Council - Stop by port" -ForegroundColor Cyan
Write-Host "Ports: $($Ports -join ', ')" -ForegroundColor Gray
if ($WhatIf) {
  Write-Host "WHATIF: will not actually kill processes." -ForegroundColor Yellow
}
Write-Host ""

$killed = @()

foreach ($p in $Ports) {
  $owning = @()
  try {
    $owning = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    $owning = @()
  }

  foreach ($procId in $owning) {
    if (-not $procId -or $procId -eq 0) { continue }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { "unknown" }

    $msg = "Port $p -> PID $procId ($name)"
    if ($WhatIf) {
      Write-Host "Would stop: $msg" -ForegroundColor Gray
    } else {
      Write-Host "Stopping:  $msg" -ForegroundColor Yellow
      try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {}
      $killed += $msg
    }
  }
}

Write-Host ""
if ($WhatIf) {
  Write-Host "Done (WHATIF)." -ForegroundColor Green
} else {
  Write-Host "Done. Killed $($killed.Count) process(es)." -ForegroundColor Green
}

Write-Host ""
Write-Host "Minimal verify (should be 000 after stop):" -ForegroundColor Gray
Write-Host "  curl.exe -s http://127.0.0.1:8001/" -ForegroundColor Gray
Write-Host "  curl.exe -s http://127.0.0.1:8001/api/workers/health" -ForegroundColor Gray
Write-Host "  curl.exe -s http://127.0.0.1:5173/" -ForegroundColor Gray

