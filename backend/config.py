"""Configuration for the (local + distributed) LLM Council.

This repo has been refactored to remove cloud APIs (OpenRouter/OpenAI/etc.).
All model inference is done locally (recommended: Ollama), while the council is
distributed across multiple machines via REST (worker services).
"""

import os
from dotenv import load_dotenv

load_dotenv()

# Data directory for conversation storage
DATA_DIR = os.getenv("DATA_DIR", "data/conversations")

# Orchestrator loads council topology from a JSON file (easy to edit on Windows)
COUNCIL_CONFIG_PATH = os.getenv("COUNCIL_CONFIG_PATH", "council_config.json")

# Network timeouts (seconds)
LLM_REQUEST_TIMEOUT_S = float(os.getenv("LLM_REQUEST_TIMEOUT_S", "180"))
TITLE_REQUEST_TIMEOUT_S = float(os.getenv("TITLE_REQUEST_TIMEOUT_S", "30"))

# CORS (useful when frontend is accessed via LAN IP instead of localhost)
# Examples:
# - CORS_ALLOW_ORIGINS=http://localhost:5173,http://192.168.0.10:5173
# - CORS_ALLOW_ORIGINS=*
CORS_ALLOW_ORIGINS = os.getenv(
    "CORS_ALLOW_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
)
