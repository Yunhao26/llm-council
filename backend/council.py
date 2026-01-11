"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Tuple
from .config import LLM_REQUEST_TIMEOUT_S, TITLE_REQUEST_TIMEOUT_S
from .council_config import load_council_topology
from .worker_client import query_workers_parallel_full, worker_chat, worker_synthesize_full


def _get_council_workers() -> List[Dict[str, str]]:
    topo = load_council_topology()
    return [{"name": w.name, "base_url": w.base_url} for w in topo.council]


def _get_chairman() -> Dict[str, str]:
    topo = load_council_topology()
    return {"name": topo.chairman.name, "base_url": topo.chairman.base_url}


def _sanitize_parsed_ranking(parsed: List[str], valid_labels: List[str]) -> List[str]:
    """Sanitize a parsed ranking to match the known set of labels.

    Some models may hallucinate extra labels (e.g. "Response C" when only A/B exist)
    or omit labels. This function:
    - filters out unknown labels
    - removes duplicates (keeps first occurrence)
    - appends any missing labels in the original valid_labels order
    """

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


async def stage1_collect_responses(user_query: str) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    messages = [{"role": "user", "content": user_query}]

    council_workers = _get_council_workers()
    responses = await query_workers_parallel_full(
        workers=council_workers,
        messages=messages,
        timeout_s=LLM_REQUEST_TIMEOUT_S,
    )

    stage1_results: List[Dict[str, Any]] = []
    for w in council_workers:
        resp = responses.get(w["name"])
        if resp is not None:
            stage1_results.append(
                {
                    "model": w["name"],
                    "response": resp.content,
                    "latency_ms": resp.latency_ms,
                    "ollama_model": resp.model,
                }
            )
    return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    valid_response_labels = [f"Response {label}" for label in labels]
    valid_response_labels_text = ", ".join(valid_response_labels)
    example_evals = "\n".join([f"Response {label} ... (your critique here)" for label in labels])
    example_ranking_lines = "\n".join(
        [f"{i}. Response {label}" for i, label in enumerate(labels, start=1)]
    )

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

There are exactly {len(labels)} responses: {valid_response_labels_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section
- Do NOT invent any additional responses. Only rank the responses listed above.

Example of the correct format for your ENTIRE response:

{example_evals}

FINAL RANKING:
{example_ranking_lines}

Now provide your evaluation and ranking:"""

    messages = [{"role": "user", "content": ranking_prompt}]

    council_workers = _get_council_workers()
    responses = await query_workers_parallel_full(
        workers=council_workers,
        messages=messages,
        timeout_s=LLM_REQUEST_TIMEOUT_S,
    )

    stage2_results: List[Dict[str, Any]] = []
    for w in council_workers:
        resp = responses.get(w["name"])
        if resp is not None:
            content = resp.content
            parsed = _sanitize_parsed_ranking(
                parse_ranking_from_text(content),
                valid_labels=valid_response_labels,
            )
            stage2_results.append(
                {
                    "model": w["name"],
                    "ranking": content,
                    "parsed_ranking": parsed,
                    "latency_ms": resp.latency_ms,
                    "ollama_model": resp.model,
                }
            )

    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2

    Returns:
        Dict with 'model' and 'response' keys
    """
    chairman = _get_chairman()

    # Call the chairman worker (separate service) to enforce "synthesis only"
    synth = await worker_synthesize_full(
        chairman_base_url=chairman["base_url"],
        user_query=user_query,
        stage1=stage1_results,
        stage2=stage2_results,
        timeout_s=LLM_REQUEST_TIMEOUT_S,
    )

    if synth is None:
        return {
            "model": chairman["name"],
            "response": "Error: Unable to generate final synthesis (chairman worker unreachable).",
        }

    return {"model": chairman["name"], "response": synth.response, "latency_ms": synth.latency_ms}


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)
    valid_labels = list(label_to_model.keys())

    for ranking in stage2_results:
        parsed_ranking = ranking.get("parsed_ranking")
        if not isinstance(parsed_ranking, list) or not parsed_ranking:
            ranking_text = ranking.get("ranking", "")
            parsed_ranking = parse_ranking_from_text(str(ranking_text))

        parsed_ranking = _sanitize_parsed_ranking(parsed_ranking, valid_labels=valid_labels)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    topo = load_council_topology()
    council_workers = _get_council_workers()

    # Pick a council worker to generate titles (NOT the chairman)
    title_worker_name = topo.title_generator or (council_workers[0]["name"] if council_workers else None)
    title_worker = next((w for w in council_workers if w["name"] == title_worker_name), None) or (
        council_workers[0] if council_workers else None
    )
    if not title_worker:
        return "New Conversation"

    messages = [{"role": "user", "content": title_prompt}]
    content = await worker_chat(
        worker_base_url=title_worker["base_url"],
        messages=messages,
        timeout_s=TITLE_REQUEST_TIMEOUT_S,
    )
    if content is None:
        return "New Conversation"

    title = content.strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def run_full_council(user_query: str) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings
    }

    return stage1_results, stage2_results, stage3_result, metadata
