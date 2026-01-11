"""Minimal Ollama REST client (local inference).

Worker services call Ollama on the same machine (default: http://localhost:11434).
Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Tuple

import httpx


def _join(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


async def ollama_chat(
    *,
    base_url: str,
    model: str,
    messages: List[Dict[str, str]],
    options: Dict[str, Any] | None = None,
    timeout_s: float = 180.0,
) -> Tuple[str, int]:
    """Call Ollama /api/chat (non-stream). Returns (content, latency_ms)."""

    t0 = time.perf_counter()
    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
    }
    if options:
        payload["options"] = options

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(_join(base_url, "/api/chat"), json=payload)
        resp.raise_for_status()
        data = resp.json()

    content = (data.get("message") or {}).get("content") or ""
    latency_ms = int((time.perf_counter() - t0) * 1000)
    return content, latency_ms


async def ollama_health(*, base_url: str, timeout_s: float = 2.0) -> bool:
    """Quick health check by hitting /api/tags."""

    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(_join(base_url, "/api/tags"))
            resp.raise_for_status()
        return True
    except Exception:
        return False

