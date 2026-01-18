# LLM Council Frontend

React + Vite UI for the LLM Council project.

## Local dev

```bash
cd frontend
npm install
npm run dev
```

Open: `http://localhost:5173/`

## API base

The frontend calls the orchestrator via `VITE_API_BASE_URL` (default: `http://localhost:8001`).

If you open the UI from another machine on the LAN, set:

```bash
VITE_API_BASE_URL=http://<PC2_IP>:8001
```

For the full setup (local + distributed), see the root `README.md`.
