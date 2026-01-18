# LLM Council (Local + Distributed)

![llmcouncil](header.jpg)

This repo implements the full 3‑stage **LLM Council** workflow fully **offline** (local inference) and supports **multi‑machine distribution via REST** (recommended local inference: Ollama). The requirements are based on [`LLM Council Local Deployment.pdf`](./LLM%20Council%20Local%20Deployment.pdf).

Workflow:

1. **Stage 1: First opinions**: multiple LLMs answer the same question independently (shown in a tab view).
2. **Stage 2: Review & ranking**: each LLM reviews anonymized answers (excluding its own), assigns **accuracy (0–10)** + **insight (0–10)** scores, and ranks by the total.
3. **Stage 3: Chairman final answer**: a **separate Chairman service** synthesizes Stage 1 + Stage 2 into a final answer.

## Architecture (Team of 3 / 3 PCs)

- **PC1 (Chairman)**: `backend/worker.py` (`WORKER_ROLE=chairman`) + local Ollama (**synthesis only**)
- **PC2 (Council‑1 + Council‑2 + Orchestrator + Frontend)**:
  - `backend/worker.py` (`WORKER_ROLE=council`) × **2** (two separate ports) + local Ollama
  - `backend/main.py` (Orchestrator API, port 8001)
  - `frontend/` (Vite dev server, port 5173)
- **PC3 (Council‑3 + Council‑4)**: `backend/worker.py` (`WORKER_ROLE=council`) × **2** + local Ollama

### Live demo roles (example assignment for this team)

- **PC2 / Presenter — Yunhao ZHOU**:
  - Runs **Council‑1 worker + Council‑2 worker + Orchestrator + Frontend**
  - Presents the UI + explains Stage 1–3 and shows health checks
- **PC3 / Council‑3 operator — Yesmine BETTAIEB**:
  - Runs **Council‑3 worker + Council‑4 worker**
  - Confirms worker is reachable on LAN (health endpoint)
- **PC1 / Chairman operator — Sébastien LEVESQUE**:
  - Runs **Chairman worker**
  - Confirms Chairman is reachable on LAN (health endpoint)

**Suggested model assignment (3 PCs / 3 models + 4 council workers):**

- **PC2 Council‑1**: `mistral:7b` (already installed on the presenter PC)
- **PC2 Council‑2**: same machine second council worker on a different port (recommended: reuse `mistral:7b` if you want to keep “one local model per machine” for strict compliance wording)
- **PC3 Council‑3**: `qwen2.5:7b`
- **PC3 Council‑4**: same machine second council worker on a different port (reuse `qwen2.5:7b`)
- **PC1 Chairman**: `llama3.1:8b`

**Recommended ports:**

- **8001**: Orchestrator (FastAPI)
- **5173**: Frontend (Vite dev)
- **8002**: Council Worker (each council machine can use the same port)
- **8004**: Council Worker (second council on the same machine, if needed)
- **8003**: Chairman Worker (chairman machine)
- **11434**: Ollama (recommended: local‑only, do not expose on LAN)

## Install dependencies

This project uses [uv](https://docs.astral.sh/uv/) for Python dependency management.

**Backend:**

```bash
uv sync
```

**Frontend:**

```bash
cd frontend
npm install
cd ..
```

## Configuration (most important)

### 0) Get the LAN IP of each PC

On each Windows machine:

```powershell
ipconfig
```

Record the **IPv4 Address** (example: `192.168.0.11`).

### 1) Configure the distributed topology for the Orchestrator

Copy and edit:

- Copy `council_config.example.json` → `council_config.json`
- Replace the IP/port values with your real LAN addresses (PC2 runs 2 council workers on two ports; PC3 runs 2 council workers on two ports; PC1 runs the chairman)
- **Tip**: `name` is displayed in the frontend tabs. Put the model name in it (example: `Council‑1 mistral:7b (PC2)`).

The Orchestrator reads `council_config.json` by default (override with `COUNCIL_CONFIG_PATH`).

### 2) Install Ollama and pull models (on each LLM PC)

- Install Ollama (Windows/macOS/Linux)
- Pull the model that your PC will run (examples):

```bash
ollama pull qwen2.5:7b
ollama pull mistral:7b
ollama pull llama3.1:8b
```

(Each PC only needs to pull the model it will run.)

## Run (Distributed / 3 PCs)

Note: to avoid the “2-council tie” problem in Stage 2 (exclude‑self), we recommend **3+ council workers**.

Strict compliance note (PDF screenshot): the requirement is that the **Chairman runs on a dedicated PC** and **at least two council LLMs run on separate PCs**, with each LLM running on its own machine. Our baseline setup satisfies this with **one council LLM on PC2** and **one council LLM on PC3**, plus the chairman on PC1. Running a *second council worker* on PC2/PC3 is an optional enhancement that can reuse the same local model instance on that machine to increase the number of peer reviews in Stage 2.

Terminology note: in this README, a “council worker” is a REST service process (`backend.worker`). If you run two council workers on the same PC, they may still use the **same** local model instance via Ollama; this increases the number of reviews without requiring additional machines.

### A. PC1 (Chairman) — start Chairman Worker

PowerShell (from repo root):

```powershell
$env:WORKER_ROLE="chairman"
$env:WORKER_NAME="Chairman (PC1)"
$env:OLLAMA_MODEL="llama3.1:8b"
$env:WORKER_PORT="8003"
uv run python -m backend.worker
```

### B. PC2 (Council‑1 + Council‑2) — start 2× Council Workers + Orchestrator + Frontend

Council Worker #1:

```powershell
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-1 (PC2)"
$env:OLLAMA_MODEL="mistral:7b"
$env:WORKER_PORT="8002"
uv run python -m backend.worker
```

Council Worker #2 (same machine, different port):

```powershell
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-2 (PC2)"
# Option A: use another model (recommended for diversity)
# $env:OLLAMA_MODEL="llama3.1:8b"
# Option B: reuse the same local model if you only have one installed
$env:OLLAMA_MODEL="mistral:7b"
$env:WORKER_PORT="8004"
uv run python -m backend.worker
```

Orchestrator:

```powershell
uv run python -m backend.main
```

Frontend:

```powershell
cd frontend
# If you open the UI via LAN IP from other PCs, replace localhost with PC2's LAN IP
$env:VITE_API_BASE_URL="http://localhost:8001"
npm run dev
```

### C. PC3 (Council‑3 + Council‑4) — start 2× Council Workers

```powershell
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-3 (PC3)"
$env:OLLAMA_MODEL="qwen2.5:7b"
$env:WORKER_PORT="8002"
uv run python -m backend.worker
```

Council Worker #2 on PC3 (second council on the same machine, different port):

```powershell
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-4 (PC3)"
$env:OLLAMA_MODEL="qwen2.5:7b"
$env:WORKER_PORT="8004"
uv run python -m backend.worker
```

Finally open on PC2: `http://localhost:5173`

## Run (Local / Single PC) — one-click scripts (Windows)

If you want a quick local demo on a single Windows PC (4 council workers + 1 chairman + orchestrator + UI), use:

```powershell
.\demo_start_local.ps1 -OllamaModel "mistral:7b"
```

Notes:
- This starts **7 long-running processes** (4× council + chairman + orchestrator + frontend). Depending on your Windows settings, you may see multiple PowerShell windows.
- Logs are written to `logs/*.out.log` and `logs/*.err.log` (git-ignored).

Stop everything by port:

```powershell
.\demo_stop.ps1
```

Minimal verify:

```powershell
.\demo_verify.ps1
```

## LAN connectivity / firewall (you must do this)

Make sure **PC2 can reach PC1:8003 and PC3:8002/8004** over HTTP. If you open the UI via LAN IP, the browser must also reach **PC2:5173 and PC2:8001**.

**Windows firewall allow rules (Admin PowerShell example):**

```powershell
netsh advfirewall firewall add rule name="LLM-Council Orchestrator 8001" dir=in action=allow protocol=TCP localport=8001
netsh advfirewall firewall add rule name="LLM-Council Frontend 5173" dir=in action=allow protocol=TCP localport=5173
netsh advfirewall firewall add rule name="LLM-Council CouncilWorker 8002" dir=in action=allow protocol=TCP localport=8002
netsh advfirewall firewall add rule name="LLM-Council CouncilWorker 8004" dir=in action=allow protocol=TCP localport=8004
netsh advfirewall firewall add rule name="LLM-Council ChairmanWorker 8003" dir=in action=allow protocol=TCP localport=8003
```

(Recommended: do **not** expose 11434 on your LAN. The worker calls Ollama locally.)

**Optional: allow PC1/PC3 to open the frontend directly**

- On PC2 run the frontend with: `npm run dev -- --host 0.0.0.0`
- Allow inbound port 5173 on PC2
- Teammates can open: `http://<PC2_IP>:5173`
- And set `VITE_API_BASE_URL` to: `http://<PC2_IP>:8001`

## Debugging

- Orchestrator health: `GET /` (default: `http://localhost:8001/`)
- Worker reachability: `GET /api/workers/health` (default: `http://localhost:8001/api/workers/health`)

## Compliance checklist (PDF Mandatory Requirements)

- [x] **No cloud APIs**: no OpenRouter/OpenAI/etc. dependency; no cloud keys required
- [x] **Local inference**: workers call local Ollama via REST
- [x] **Distributed architecture (REST)**: Orchestrator calls multiple workers from `council_config.json`
- [x] **Chairman separation**: chairman runs as a separate service and only exposes `/api/synthesize`
- [x] **Stage 1–3 end‑to‑end**: validated with multi‑process local testing (incl. SSE streaming)

## Deliverables template (fill in for your submission)

- **Group members / TD group**: `CDOF3` — Yunhao ZHOU, Yesmine BETTAIEB, Sébastien LEVESQUE
- **Chosen local models**: `mistral:7b` (Council‑1), `qwen2.5:7b` (Council‑3), `llama3.1:8b` (Chairman) + optional second council model on PC2 (or reuse `mistral:7b` on a second port)
- **Key design decisions**:
  - Use **Ollama (local REST)** for all inference; no cloud keys or OpenRouter/OpenAI dependencies.
  - Use **worker services** per machine (REST) and a central **Orchestrator** that fans out calls in parallel (async).
  - Enforce **Chairman separation** with `WORKER_ROLE` (chairman exposes `/api/synthesize` only).
  - Stage 2 anonymization: label responses as **Response A/B/...**; robust ranking parsing + sanitization.
- UX/observability: stage-level **SSE streaming**, worker health dashboard (incl. busy/in-flight), latency + token counts (Ollama when available, fallback estimate), compare + diff.
- **Generative AI Usage Statement**:
  - Tools/models used: Cursor — GPT‑5.2 Extra High Fast Model
  - Purpose: code review, debugging, UI/UX improvements, and documentation updates (transparent assistance)

## Tech Stack

- **Backend (Orchestrator + Worker)**: FastAPI (Python 3.10+), async httpx
- **Local inference**: Ollama (via REST)
- **Frontend**: React + Vite, react-markdown
- **Storage**: JSON files under `data/conversations/`
- **Package management**: uv (Python), npm (JS)
