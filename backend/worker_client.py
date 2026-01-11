"""Orchestrator-side client for calling remote worker services."""

from __future__ import annotations

import asyncio
from typing import Dict, List, Optional

import httpx

from .worker_protocol import (
    ChatRequest,
    ChatResponse,
    HealthResponse,
    SynthesizeRequest,
    SynthesizeResponse,
)


def _join(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


async def worker_chat(
    *,
    worker_base_url: str,
    messages: List[dict],
    timeout_s: float,
) -> Optional[str]:
    r = await worker_chat_full(worker_base_url=worker_base_url, messages=messages, timeout_s=timeout_s)
    if r is None:
        return None
    return r.content or ""


async def worker_chat_full(
    *,
    worker_base_url: str,
    messages: List[dict],
    timeout_s: float,
) -> Optional[ChatResponse]:
    try:
        req = ChatRequest(messages=messages)  # type: ignore[arg-type]
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(_join(worker_base_url, "/api/chat"), json=req.model_dump())
            resp.raise_for_status()
            return ChatResponse.model_validate(resp.json())
    except Exception as e:
        print(f"[worker_chat] Error calling {worker_base_url}: {e}")
        return None


async def worker_synthesize(
    *,
    chairman_base_url: str,
    user_query: str,
    stage1: List[dict],
    stage2: List[dict],
    timeout_s: float,
) -> Optional[str]:
    r = await worker_synthesize_full(
        chairman_base_url=chairman_base_url,
        user_query=user_query,
        stage1=stage1,
        stage2=stage2,
        timeout_s=timeout_s,
    )
    if r is None:
        return None
    return r.response or ""


async def worker_synthesize_full(
    *,
    chairman_base_url: str,
    user_query: str,
    stage1: List[dict],
    stage2: List[dict],
    timeout_s: float,
) -> Optional[SynthesizeResponse]:
    try:
        req = SynthesizeRequest(user_query=user_query, stage1=stage1, stage2=stage2)
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                _join(chairman_base_url, "/api/synthesize"),
                json=req.model_dump(),
            )
            resp.raise_for_status()
            return SynthesizeResponse.model_validate(resp.json())
    except Exception as e:
        print(f"[worker_synthesize] Error calling {chairman_base_url}: {e}")
        return None


async def worker_health(
    *,
    worker_base_url: str,
    timeout_s: float = 2.0,
) -> Optional[HealthResponse]:
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.get(_join(worker_base_url, "/api/health"))
            resp.raise_for_status()
            return HealthResponse.model_validate(resp.json())
    except Exception:
        return None


async def query_workers_parallel(
    *,
    workers: List[dict],
    messages: List[dict],
    timeout_s: float,
) -> Dict[str, Optional[str]]:
    """Query multiple council workers in parallel. workers: [{name, base_url}, ...]."""

    tasks = [
        worker_chat(worker_base_url=w["base_url"], messages=messages, timeout_s=timeout_s)
        for w in workers
    ]
    results = await asyncio.gather(*tasks)
    return {w["name"]: r for w, r in zip(workers, results)}


async def query_workers_parallel_full(
    *,
    workers: List[dict],
    messages: List[dict],
    timeout_s: float,
) -> Dict[str, Optional[ChatResponse]]:
    """Query multiple council workers in parallel (full response, incl. latency)."""

    tasks = [
        worker_chat_full(worker_base_url=w["base_url"], messages=messages, timeout_s=timeout_s)
        for w in workers
    ]
    results = await asyncio.gather(*tasks)
    return {w["name"]: r for w, r in zip(workers, results)}

