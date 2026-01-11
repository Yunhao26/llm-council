"""Shared request/response schemas for worker <-> orchestrator communication."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    options: Dict[str, Any] = Field(default_factory=dict)  # passed to Ollama as-is
    timeout_s: Optional[float] = None


class ChatResponse(BaseModel):
    content: str
    latency_ms: int
    worker_name: str
    model: str
    role: Literal["council", "chairman"]


class SynthesizeRequest(BaseModel):
    user_query: str
    stage1: List[Dict[str, Any]]
    stage2: List[Dict[str, Any]]
    timeout_s: Optional[float] = None


class SynthesizeResponse(BaseModel):
    model: str
    response: str
    latency_ms: int


class HealthResponse(BaseModel):
    status: Literal["ok"]
    role: Literal["council", "chairman"]
    worker_name: str
    model: str
    ollama_base_url: str
    ollama_ok: bool
    # Bonus: load/availability indicator (best-effort; used by UI as idle/busy)
    active_requests: int = 0
    busy: bool = False

