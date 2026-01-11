# LLM Council (Local + Distributed)

![llmcouncil](header.jpg)

This repo implements the full 3‑stage **LLM Council** workflow fully **offline** (local inference) and supports **multi‑machine distribution via REST** (recommended local inference: Ollama). The requirements are based on [`LLM Council Local Deployment.pdf`](file:///c%3A/Users/ZHOU/llm-council/LLM%20Council%20Local%20Deployment.pdf).

Workflow:

1. **Stage 1: First opinions**: multiple LLMs answer the same question independently (shown in a tab view).
2. **Stage 2: Review & ranking**: each LLM reviews anonymized answers and ranks them by accuracy and insight.
3. **Stage 3: Chairman final answer**: a **separate Chairman service** synthesizes Stage 1 + Stage 2 into a final answer.

## Architecture (Team of 3 / 3 PCs)

- **PC1 (Chairman)**: `backend/worker.py` (`WORKER_ROLE=chairman`) + local Ollama (**synthesis only**)
- **PC2 (Council‑1 + Orchestrator + Frontend)**:
  - `backend/worker.py` (`WORKER_ROLE=council`) + local Ollama
  - `backend/main.py` (Orchestrator API, port 8001)
  - `frontend/` (Vite dev server, port 5173)
- **PC3 (Council‑2)**: `backend/worker.py` (`WORKER_ROLE=council`) + local Ollama

**Suggested model assignment (3 PCs / 3 models):**

- **PC2 Council‑1**: `qwen2.5:7b`
- **PC3 Council‑2**: `mistral:7b`
- **PC1 Chairman**: `llama3.1:8b`

**Recommended ports:**

- **8001**: Orchestrator (FastAPI)
- **5173**: Frontend (Vite dev)
- **8002**: Council Worker (each council machine can use the same port)
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
- Replace the IP/port values with your real LAN addresses (PC2/PC3 run council workers; PC1 runs the chairman worker)
- **Tip**: `name` is displayed in the frontend tabs. Put the model name in it (example: `Council‑1 qwen2.5:7b (PC2)`).

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

### A. PC1 (Chairman) — start Chairman Worker

PowerShell (from repo root):

```powershell
$env:WORKER_ROLE="chairman"
$env:WORKER_NAME="Chairman (PC1)"
$env:OLLAMA_MODEL="llama3.1:8b"
$env:WORKER_PORT="8003"
uv run python -m backend.worker
```

### B. PC2 (Council‑1) — start Council Worker + Orchestrator + Frontend

Council Worker:

```powershell
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-1 (PC2)"
$env:OLLAMA_MODEL="qwen2.5:7b"
$env:WORKER_PORT="8002"
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

### C. PC3 (Council‑2) — start Council Worker

```powershell
$env:WORKER_ROLE="council"
$env:WORKER_NAME="Council-2 (PC3)"
$env:OLLAMA_MODEL="mistral:7b"
$env:WORKER_PORT="8002"
uv run python -m backend.worker
```

Finally open on PC2: `http://localhost:5173`

## LAN connectivity / firewall (you must do this)

Make sure **PC2 can reach PC1:8003 and PC3:8002** over HTTP. If you open the UI via LAN IP, the browser must also reach **PC2:5173 and PC2:8001**.

**Windows firewall allow rules (Admin PowerShell example):**

```powershell
netsh advfirewall firewall add rule name="LLM-Council Orchestrator 8001" dir=in action=allow protocol=TCP localport=8001
netsh advfirewall firewall add rule name="LLM-Council Frontend 5173" dir=in action=allow protocol=TCP localport=5173
netsh advfirewall firewall add rule name="LLM-Council CouncilWorker 8002" dir=in action=allow protocol=TCP localport=8002
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

- **Group members / TD group**: `TODO`
- **Chosen local models**: `TODO`
- **Key design decisions**: `TODO`
- **Generative AI Usage Statement**:
  - Tools/models used: `TODO`
  - Purpose (refactor, docs, debugging, etc.): `TODO`

## Tech Stack

- **Backend (Orchestrator + Worker)**: FastAPI (Python 3.10+), async httpx
- **Local inference**: Ollama (via REST)
- **Frontend**: React + Vite, react-markdown
- **Storage**: JSON files under `data/conversations/`
- **Package management**: uv (Python), npm (JS)
