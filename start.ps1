$ErrorActionPreference = "Stop"

Write-Host "Starting LLM Council (Orchestrator + Frontend)..." -ForegroundColor Cyan
Write-Host ""
Write-Host "NOTE: This script starts ONLY the Orchestrator (8001) + Frontend (5173)." -ForegroundColor Yellow
Write-Host "Make sure your Council/Chairman worker services are already running." -ForegroundColor Yellow
Write-Host ""

Write-Host "Starting backend on http://localhost:8001 ..." -ForegroundColor Green
Start-Process -FilePath "uv" -ArgumentList @("run", "python", "-m", "backend.main")

Start-Sleep -Seconds 2

Write-Host "Starting frontend on http://localhost:5173 ..." -ForegroundColor Green
Push-Location "frontend"
Start-Process -FilePath "npm" -ArgumentList @("run", "dev")
Pop-Location

Write-Host ""
Write-Host "✓ LLM Council is starting." -ForegroundColor Green
Write-Host "  Backend:  http://localhost:8001" -ForegroundColor Gray
Write-Host "  Frontend: http://localhost:5173" -ForegroundColor Gray

