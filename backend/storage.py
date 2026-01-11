"""JSON-based storage for conversations."""

import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
from .config import DATA_DIR


def ensure_data_dir():
    """Ensure the data directory exists."""
    Path(DATA_DIR).mkdir(parents=True, exist_ok=True)


def get_conversation_path(conversation_id: str) -> str:
    """Get the file path for a conversation."""
    return os.path.join(DATA_DIR, f"{conversation_id}.json")


def create_conversation(conversation_id: str) -> Dict[str, Any]:
    """
    Create a new conversation.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        New conversation dict
    """
    ensure_data_dir()

    conversation = {
        "id": conversation_id,
        "created_at": datetime.utcnow().isoformat(),
        "title": "New Conversation",
        "messages": []
    }

    # Save to file
    path = get_conversation_path(conversation_id)
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)

    return conversation


def get_conversation(conversation_id: str) -> Optional[Dict[str, Any]]:
    """
    Load a conversation from storage.

    Args:
        conversation_id: Unique identifier for the conversation

    Returns:
        Conversation dict or None if not found
    """
    path = get_conversation_path(conversation_id)

    if not os.path.exists(path):
        return None

    with open(path, 'r') as f:
        conversation = json.load(f)

    # Backward-compatible upgrade: older conversations may be missing assistant metadata
    # (e.g., label_to_model / aggregate_rankings) and may contain unsanitized parsed_ranking.
    if isinstance(conversation, dict) and _upgrade_conversation_in_place(conversation):
        save_conversation(conversation)

    return conversation


def save_conversation(conversation: Dict[str, Any]):
    """
    Save a conversation to storage.

    Args:
        conversation: Conversation dict to save
    """
    ensure_data_dir()

    path = get_conversation_path(conversation['id'])
    with open(path, 'w') as f:
        json.dump(conversation, f, indent=2)


def list_conversations() -> List[Dict[str, Any]]:
    """
    List all conversations (metadata only).

    Returns:
        List of conversation metadata dicts
    """
    ensure_data_dir()

    conversations = []
    for filename in os.listdir(DATA_DIR):
        if filename.endswith('.json'):
            path = os.path.join(DATA_DIR, filename)
            with open(path, 'r') as f:
                data = json.load(f)
                # Return metadata only
                conversations.append({
                    "id": data["id"],
                    "created_at": data["created_at"],
                    "title": data.get("title", "New Conversation"),
                    "message_count": len(data["messages"])
                })

    # Sort by creation time, newest first
    conversations.sort(key=lambda x: x["created_at"], reverse=True)

    return conversations


def add_user_message(conversation_id: str, content: str):
    """
    Add a user message to a conversation.

    Args:
        conversation_id: Conversation identifier
        content: User message content
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["messages"].append({
        "role": "user",
        "content": content
    })

    save_conversation(conversation)


def add_assistant_message(
    conversation_id: str,
    stage1: List[Dict[str, Any]],
    stage2: List[Dict[str, Any]],
    stage3: Dict[str, Any],
    metadata: Optional[Dict[str, Any]] = None,
):
    """
    Add an assistant message with all 3 stages to a conversation.

    Args:
        conversation_id: Conversation identifier
        stage1: List of individual model responses
        stage2: List of model rankings
        stage3: Final synthesized response
        metadata: Optional metadata (e.g., label_to_model mapping, aggregate rankings)
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    message: Dict[str, Any] = {
        "role": "assistant",
        "stage1": stage1,
        "stage2": stage2,
        "stage3": stage3,
    }
    if metadata is not None:
        message["metadata"] = metadata

    conversation["messages"].append(message)

    save_conversation(conversation)


def _sanitize_parsed_ranking(parsed: List[str], valid_labels: List[str]) -> List[str]:
    """Ensure parsed ranking matches the known set of labels (filter unknowns, de-dupe, append missing)."""
    valid_set = set(valid_labels)
    seen = set()
    cleaned: List[str] = []

    for label in parsed:
        if label in valid_set and label not in seen:
            cleaned.append(label)
            seen.add(label)

    for label in valid_labels:
        if label not in seen:
            cleaned.append(label)
            seen.add(label)

    return cleaned


def _infer_label_to_model(stage1: Any) -> Dict[str, str]:
    """Reconstruct label_to_model from Stage 1 results (Response A/B/C in Stage 1 order)."""
    if not isinstance(stage1, list):
        return {}

    labels = [chr(65 + i) for i in range(len(stage1))]  # A, B, C...
    mapping: Dict[str, str] = {}
    for label, item in zip(labels, stage1):
        model_name: Any = None
        if isinstance(item, dict):
            model_name = item.get("model")
        mapping[f"Response {label}"] = str(model_name) if model_name else f"Unknown-{label}"
    return mapping


def _upgrade_assistant_message_in_place(message: Dict[str, Any]) -> bool:
    """Backfill missing metadata and sanitize stage2 parsed_ranking in-place. Returns True if modified."""
    if message.get("role") != "assistant":
        return False

    stage1 = message.get("stage1")
    stage2 = message.get("stage2")
    if not isinstance(stage1, list) or not isinstance(stage2, list):
        return False

    mutated = False

    # Ensure metadata exists
    metadata = message.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        message["metadata"] = metadata
        mutated = True

    # label_to_model: infer from stage1 if missing/invalid
    label_to_model = metadata.get("label_to_model")
    if not isinstance(label_to_model, dict) or not label_to_model:
        label_to_model = _infer_label_to_model(stage1)
        metadata["label_to_model"] = label_to_model
        mutated = True

    valid_labels = list(label_to_model.keys()) if isinstance(label_to_model, dict) else []

    # Sanitize/repair stage2 parsed_ranking for UI + aggregation stability
    if valid_labels:
        from .council import parse_ranking_from_text  # local import to avoid heavy imports for non-upgrade paths

        for entry in stage2:
            if not isinstance(entry, dict):
                continue

            parsed = entry.get("parsed_ranking")
            if not isinstance(parsed, list) or not parsed:
                ranking_text = entry.get("ranking", "")
                parsed = parse_ranking_from_text(str(ranking_text))
                mutated = True

            parsed = [str(x) for x in parsed]
            cleaned = _sanitize_parsed_ranking(parsed, valid_labels=valid_labels)
            if entry.get("parsed_ranking") != cleaned:
                entry["parsed_ranking"] = cleaned
                mutated = True

    # aggregate_rankings: compute if missing/invalid
    aggregate_rankings = metadata.get("aggregate_rankings")
    if not isinstance(aggregate_rankings, list) or not aggregate_rankings:
        from .council import calculate_aggregate_rankings  # local import to avoid heavy imports for non-upgrade paths

        aggregate_rankings = calculate_aggregate_rankings(stage2, label_to_model)
        metadata["aggregate_rankings"] = aggregate_rankings
        mutated = True

    return mutated


def _upgrade_conversation_in_place(conversation: Dict[str, Any]) -> bool:
    """Upgrade a conversation dict to the latest on-disk schema in a backward-compatible way."""
    messages = conversation.get("messages")
    if not isinstance(messages, list):
        return False

    mutated = False
    for msg in messages:
        if isinstance(msg, dict):
            if _upgrade_assistant_message_in_place(msg):
                mutated = True
    return mutated


def update_conversation_title(conversation_id: str, title: str):
    """
    Update the title of a conversation.

    Args:
        conversation_id: Conversation identifier
        title: New title for the conversation
    """
    conversation = get_conversation(conversation_id)
    if conversation is None:
        raise ValueError(f"Conversation {conversation_id} not found")

    conversation["title"] = title
    save_conversation(conversation)
