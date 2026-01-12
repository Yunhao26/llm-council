# CLAUDE.md - Technical Notes for LLM Council

This file contains technical details, architectural decisions, and important implementation notes for future development sessions.

## Project Overview

LLM Council is a 3-stage deliberation system where multiple LLMs collaboratively answer user questions. The key innovation is anonymized peer review in Stage 2, preventing models from playing favorites.
In this repo, Stage 2 also **excludes self-evaluation** (each reviewer does NOT see its own Stage 1 answer).

## Architecture

### Backend Structure (`backend/`)

**`config.py`**
- Orchestrator reads `council_config.json` (distributed topology) via `COUNCIL_CONFIG_PATH`
- Defines timeouts and CORS settings
- Backend runs on **port 8001** (NOT 8000 - user had another app on 8000)

**`worker.py`**
- Worker service that runs on each machine next to a local LLM (recommended: Ollama)
- `WORKER_ROLE=council` serves `/api/chat` (Stage 1 & 2)
- `WORKER_ROLE=chairman` serves `/api/synthesize` (Stage 3 only, enforced)

**`worker_client.py`**
- Orchestrator-side HTTP client calling worker services in parallel (asyncio.gather)

**`ollama.py`**
- Minimal REST client calling local Ollama `/api/chat`

**`council.py`** - The Core Logic
- `stage1_collect_responses()`: Parallel queries to all council workers
- `stage2_collect_rankings()`:
  - Anonymizes responses as "Response A, B, C, etc."
  - Creates `label_to_model` mapping for de-anonymization
  - Excludes the reviewer's own Stage 1 answer from the review set (peer review only)
  - Prompts models to evaluate and score each response using TWO criteria:
    - **Accuracy (0–10)**
    - **Insight (0–10)**
  - Requires a strict, parseable output containing BOTH sections:
    - `SCORES:` (one line per response, includes accuracy/insight/total)
    - `FINAL RANKING:` (best to worst, based on total)
  - Returns tuple: (rankings_list, label_to_model_dict)
  - Each ranking includes:
    - raw text (`ranking`)
    - parsed ranking list (`parsed_ranking`)
    - parsed score table (`parsed_scores`)
    - reviewed label subset (`reviewed_labels`) + excluded label (`excluded_label`)
- `stage3_synthesize_final()`: Calls chairman worker `/api/synthesize` (separate service)
- `parse_ranking_from_text()`: Extracts "FINAL RANKING:" section, handles both numbered lists and plain format
- `parse_scores_from_text()`: Extracts the `SCORES:` section into a structured `{label -> {accuracy, insight, total}}` dict
- `calculate_aggregate_rankings()`: Computes average rank position across all peer evaluations
- `calculate_aggregate_scores()`: Computes average accuracy/insight/total per model across all peer evaluations

**`storage.py`**
- JSON-based conversation storage in `data/conversations/`
- Each conversation: `{id, created_at, messages[]}`
- Assistant messages contain: `{role, stage1, stage2, stage3, metadata?}`
- Metadata (e.g. `label_to_model`, `aggregate_rankings`, `aggregate_scores`) IS persisted to the conversation JSON for assistant messages.
- Backward compatible: older conversations missing metadata / parsed rankings are upgraded in-place on load and re-saved.

**`main.py`**
- FastAPI app with CORS enabled for localhost:5173 and localhost:3000
- POST `/api/conversations/{id}/message` returns metadata in addition to stages
- Metadata includes: label_to_model mapping, aggregate_rankings, aggregate_scores

### Frontend Structure (`frontend/src/`)

**`App.jsx`**
- Main orchestration: manages conversations list and current conversation
- Handles message sending and metadata storage
- Important: metadata is stored in UI state for display AND is persisted to backend JSON via `storage.py`.

**`components/ChatInterface.jsx`**
- Multiline textarea (3 rows, resizable)
- Enter to send, Shift+Enter for new line
- User messages wrapped in markdown-content class for padding

**`components/Stage1.jsx`**
- Tab view of individual model responses
- ReactMarkdown rendering with markdown-content wrapper

**`components/Stage2.jsx`**
- **Critical Feature**: Tab view showing RAW evaluation text from each model
- De-anonymization happens CLIENT-SIDE for display (models receive anonymous labels)
- Shows "Extracted Ranking" below each evaluation so users can validate parsing
- Shows an "Extracted Scores" table (accuracy/insight/total) when parseable
- Aggregate rankings shown with average position and vote count
- Aggregate scores shown as averaged accuracy/insight/total across reviewers
- Explanatory text clarifies that boldface model names are for readability only
  - Also clarifies that reviewers do NOT see their own Stage 1 response (exclude-self peer review)

**`components/Stage3.jsx`**
- Final synthesized answer from chairman
- Green-tinted background (#f0fff0) to highlight conclusion

**Styling (`*.css`)**
- Light + dark mode themes (toggle stored in localStorage)
- Primary color: #4a90e2 (blue)
- Global markdown styling in `index.css` with `.markdown-content` class
- 12px padding on all markdown content to prevent cluttered appearance

## Key Design Decisions

### Stage 2 Prompt Format
The Stage 2 prompt is very specific to ensure parseable output (evaluation + scoring + ranking):
```
1. Evaluate each response (accuracy + insight)
2. Provide a "SCORES:" section (ALL CAPS) with one line per response:
   Response X | accuracy=<0-10> | insight=<0-10> | total=<accuracy+insight>
3. Provide a "FINAL RANKING:" section based on total (tie-break by accuracy then insight)
```

This strict format allows reliable parsing while still getting thoughtful evaluations.

### De-anonymization Strategy
- Models receive: "Response A", "Response B", etc.
- Backend creates mapping from labels to council worker display names from `council_config.json` (e.g. `{"Response A": "Council-A (...)", ...}`)
- Frontend displays model names in **bold** for readability
- Users see explanation that original evaluation used anonymous labels
- This prevents bias while maintaining transparency
- Additionally, each reviewer does NOT see its own response (exclude-self peer review)

### Error Handling Philosophy
- Continue with successful responses if some models fail (graceful degradation)
- Never fail the entire request due to single model failure
- Log errors but don't expose to user unless all models fail

### UI/UX Transparency
- All raw outputs are inspectable via tabs
- Parsed rankings shown below raw text for validation
- Users can verify system's interpretation of model outputs
- This builds trust and allows debugging of edge cases

## Important Implementation Details

### Relative Imports
All backend modules use relative imports (e.g., `from .config import ...`) not absolute imports. This is critical for Python's module system to work correctly when running as `python -m backend.main`.

### Port Configuration
- Backend: 8001 (changed from 8000 to avoid conflict)
- Frontend: 5173 (Vite default)
- Update both `backend/main.py` and `frontend/src/api.js` if changing

### Markdown Rendering
All ReactMarkdown components must be wrapped in `<div className="markdown-content">` for proper spacing. This class is defined globally in `index.css`.

### Model Configuration
Each machine chooses its own local model via env `OLLAMA_MODEL`. The orchestrator only knows worker URLs + display names from `council_config.json`.

## Common Gotchas

1. **Module Import Errors**: Always run backend as `python -m backend.main` from project root, not from backend directory
2. **CORS Issues**: Frontend must match allowed origins in `main.py` CORS middleware
3. **Ranking Parse Failures**: If models don't follow format, fallback regex extracts any "Response X" patterns in order
5. **Score Parse Failures**: The backend parses scores best-effort from the `SCORES:` section; if missing/invalid, the UI may omit the score table.
4. **Older Conversations Missing Metadata**: older JSON may lack metadata; `storage.py` upgrades on load and persists it.
6. **2-council tie (exclude-self)**: If only **2** council responses exist and we exclude self-review, each reviewer sees only **1** response. This makes `aggregate_rankings` (avg position) degenerate into a tie (Avg=1.00 for both). Use **3+ council workers** for meaningful Stage 2 rankings (and more robust aggregate scores). In a 3-PC demo, a common pattern is PC2 runs 2 council workers (two ports), PC3 runs 2 council workers (two ports), and PC1 runs the chairman.

## Future Enhancement Ideas

- Configurable council/chairman via UI instead of config file
- Token-level streaming (Ollama stream=true) instead of stage-level SSE events
- Export conversations to markdown/PDF
- Model performance analytics over time
- Custom ranking criteria (not just accuracy/insight)
- Support for reasoning models (o1, etc.) with special handling

## Testing Notes

Use `GET /api/workers/health` on the orchestrator to verify worker reachability and Ollama status.

## Data Flow Summary

```
User Query
    ↓
Stage 1: Parallel queries → [individual responses]
    ↓
Stage 2: Anonymize → Parallel ranking queries → [evaluations + parsed rankings]
    ↓
Aggregate Rankings + Scores Calculation → [avg position + avg accuracy/insight/total]
    ↓
Stage 3: Chairman synthesis with full context
    ↓
Return: {stage1, stage2, stage3, metadata}
    ↓
Frontend: Display with tabs + validation UI
```

The entire flow is async/parallel where possible to minimize latency.
