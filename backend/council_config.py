"""Council topology config loader (JSON) for distributed deployments."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from pydantic import AnyHttpUrl, BaseModel, Field, ValidationError


class WorkerEndpoint(BaseModel):
    """A remote worker service endpoint."""

    name: str = Field(min_length=1)
    url: AnyHttpUrl

    @property
    def base_url(self) -> str:
        return str(self.url).rstrip("/")


class CouncilTopology(BaseModel):
    """Full council topology: council members + chairman."""

    council: List[WorkerEndpoint] = Field(min_length=1)
    chairman: WorkerEndpoint
    title_generator: Optional[str] = None  # worker name (must be in council)


@lru_cache
def load_council_topology(path: str | None = None) -> CouncilTopology:
    """Load council topology from a JSON file."""

    config_path = path or os.getenv("COUNCIL_CONFIG_PATH", "council_config.json")
    p = Path(config_path)
    if not p.exists():
        raise FileNotFoundError(
            f"Council config not found: {p.resolve()}. "
            "Create `council_config.json` (see `council_config.example.json`)."
        )

    raw = p.read_text(encoding="utf-8")
    data = json.loads(raw)

    try:
        topo = CouncilTopology.model_validate(data)
    except ValidationError as e:
        raise ValueError(f"Invalid council config in {p}: {e}") from e

    return topo

