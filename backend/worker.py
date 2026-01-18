"""Worker service: runs on each machine next to a local LLM (recommended: Ollama).

Roles:
- council: serves /api/chat for Stage 1 & Stage 2
- chairman: serves /api/synthesize for Stage 3 only (enforced)
"""

from __future__ import annotations

import os
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

from .ollama import ollama_chat, ollama_health
from .worker_protocol import (
    ChatRequest,
    ChatResponse,
    HealthResponse,
    SynthesizeRequest,
    SynthesizeResponse,
)
from .config import LLM_REQUEST_TIMEOUT_S

load_dotenv()

WORKER_ROLE = os.getenv("WORKER_ROLE", "council").strip().lower()
if WORKER_ROLE not in {"council", "chairman"}:
    raise ValueError("WORKER_ROLE must be 'council' or 'chairman'")

WORKER_NAME = os.getenv("WORKER_NAME", "Council Worker" if WORKER_ROLE == "council" else "Chairman")

WORKER_HOST = os.getenv("WORKER_HOST", "0.0.0.0")
WORKER_PORT = int(os.getenv("WORKER_PORT", "8002" if WORKER_ROLE == "council" else "8003"))

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.1:8b")

app = FastAPI(title=f"LLM Council Worker ({WORKER_ROLE})")

_ACTIVE_REQUESTS = 0


_ENGLISH_ONLY_SYSTEM = (
    "LANGUAGE RULE (highest priority): You must write your entire response in English ONLY. "
    "Do NOT output any other language (including Chinese, Russian, etc.). "
    "If the user input is not English, translate it internally and answer in English. "
    "If the task requires a specific format (headings/labels/numbers), keep that format exactly."
)


def _ensure_english_system_message(messages: list[dict]) -> list[dict]:
    """
    Ensure there is a (single) system instruction enforcing English output.

    Strategy:
    - If an existing system message exists, append the rule to the FIRST system message (best-effort).
    - Otherwise, prepend a new system message.
    """

    if not isinstance(messages, list):
        return [{"role": "system", "content": _ENGLISH_ONLY_SYSTEM}]

    for msg in messages:
        if isinstance(msg, dict) and msg.get("role") == "system":
            existing = str(msg.get("content", "") or "")
            if "English ONLY" in existing or "respond in English" in existing:
                return messages
            msg["content"] = (existing.rstrip() + "\n\n" + _ENGLISH_ONLY_SYSTEM).strip()
            return messages

    return [{"role": "system", "content": _ENGLISH_ONLY_SYSTEM}] + messages


def _inc_active_requests() -> None:
    global _ACTIVE_REQUESTS
    _ACTIVE_REQUESTS += 1


def _dec_active_requests() -> None:
    global _ACTIVE_REQUESTS
    _ACTIVE_REQUESTS = max(0, _ACTIVE_REQUESTS - 1)


def _get_active_requests() -> int:
    return int(_ACTIVE_REQUESTS)


@app.get("/")
async def root():
    return {"status": "ok", "service": "LLM Council Worker", "role": WORKER_ROLE}


@app.get("/api/health", response_model=HealthResponse)
async def health():
    ok = await ollama_health(base_url=OLLAMA_BASE_URL)
    active = _get_active_requests()
    return HealthResponse(
        status="ok",
        role=WORKER_ROLE,  # type: ignore[arg-type]
        worker_name=WORKER_NAME,
        model=OLLAMA_MODEL,
        ollama_base_url=OLLAMA_BASE_URL,
        ollama_ok=ok,
        active_requests=active,
        busy=active > 0,
    )


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if WORKER_ROLE != "council":
        raise HTTPException(status_code=403, detail="This worker is not allowed to serve /api/chat")

    _inc_active_requests()
    try:
        timeout_s = float(req.timeout_s or LLM_REQUEST_TIMEOUT_S)
        messages = _ensure_english_system_message([m.model_dump() for m in req.messages])
        content, latency_ms, usage = await ollama_chat(
            base_url=OLLAMA_BASE_URL,
            model=OLLAMA_MODEL,
            messages=messages,
            options=req.options,
            timeout_s=timeout_s,
        )
        return ChatResponse(
            content=content,
            latency_ms=latency_ms,
            worker_name=WORKER_NAME,
            model=OLLAMA_MODEL,
            role=WORKER_ROLE,  # type: ignore[arg-type]
            prompt_tokens=(usage or {}).get("prompt_tokens"),
            completion_tokens=(usage or {}).get("completion_tokens"),
            total_tokens=(usage or {}).get("total_tokens"),
        )
    finally:
        _dec_active_requests()


@app.post("/api/synthesize", response_model=SynthesizeResponse)
async def synthesize(req: SynthesizeRequest):
    if WORKER_ROLE != "chairman":
        raise HTTPException(status_code=403, detail="This worker is not allowed to serve /api/synthesize")

    _inc_active_requests()
    try:
        stage1_text = "\n\n".join(
            [
                f"Model: {r.get('model')}\nResponse: {r.get('response')}"
                for r in req.stage1
            ]
        )
        stage2_text = "\n\n".join(
            [
                f"Model: {r.get('model')}\nRanking: {r.get('ranking')}"
                for r in req.stage2
            ]
        )

        chairman_prompt = f"""You are the Chairman of an LLM Council.

IMPORTANT: Your ENTIRE output MUST be in English only. Do not use any non-English language or non-English quotes.

Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {req.user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

        timeout_s = float(req.timeout_s or LLM_REQUEST_TIMEOUT_S)
        content, latency_ms, usage = await ollama_chat(
            base_url=OLLAMA_BASE_URL,
            model=OLLAMA_MODEL,
            messages=_ensure_english_system_message([{"role": "user", "content": chairman_prompt}]),
            timeout_s=timeout_s,
        )

        return SynthesizeResponse(
            model=WORKER_NAME,
            response=content,
            latency_ms=latency_ms,
            prompt_tokens=(usage or {}).get("prompt_tokens"),
            completion_tokens=(usage or {}).get("completion_tokens"),
            total_tokens=(usage or {}).get("total_tokens"),
        )
    finally:
        _dec_active_requests()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=WORKER_HOST, port=WORKER_PORT)

