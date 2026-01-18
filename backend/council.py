"""3-stage LLM Council orchestration."""

import asyncio
from typing import List, Dict, Any, Tuple
from .config import LLM_REQUEST_TIMEOUT_S, TITLE_REQUEST_TIMEOUT_S
from .council_config import load_council_topology
from .worker_client import query_workers_parallel_full, worker_chat, worker_chat_full, worker_synthesize_full


_ENGLISH_ONLY_SYSTEM_PROMPT = (
    "You MUST respond in English only.\n"
    "- Do not use Chinese, Russian/Cyrillic, Japanese, Korean, Arabic, or any other non-English language.\n"
    "- Do NOT quote or reproduce non-English user text. If needed, paraphrase it in English.\n"
    "- Output plain English text only."
)


def _contains_non_english_script(text: str) -> bool:
    """Heuristic: detect common non-English scripts (CJK, Cyrillic, Arabic, etc.)."""
    import re

    s = str(text or "")
    return bool(
        re.search(
            r"[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF]",
            s,
        )
    )


async def normalize_user_query_to_english(user_query: str) -> str:
    """Best-effort normalize the user query to English (so downstream stages can be English-only)."""

    s = str(user_query or "").strip()
    if not s:
        return s
    if not _contains_non_english_script(s):
        return s

    council_workers = _get_council_workers()
    topo = load_council_topology()
    preferred_name = topo.title_generator or (council_workers[0]["name"] if council_workers else None)
    w = next((x for x in council_workers if x["name"] == preferred_name), None) or (
        council_workers[0] if council_workers else None
    )
    if not w:
        return s

    prompt = (
        "Translate the following user message into English.\n"
        "IMPORTANT:\n"
        "- Output ONLY the English translation.\n"
        "- Do NOT include the original text.\n"
        "- Do NOT add explanations.\n\n"
        f"Text:\n{s}\n\n"
        "English:"
    )
    resp = await worker_chat_full(
        worker_base_url=w["base_url"],
        messages=[
            {"role": "system", "content": _ENGLISH_ONLY_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        timeout_s=TITLE_REQUEST_TIMEOUT_S,
    )
    if resp is None:
        return s

    out = str(resp.content or "").strip().strip('"\'')
    # If still contains non-English scripts, fall back to original (Stage1 will still enforce English-only).
    return out if out and not _contains_non_english_script(out) else s


async def _rewrite_to_english_chat(worker_base_url: str, text: str, *, preserve_format_hint: str = ""):
    """Best-effort rewrite a text to English using the same council worker (/api/chat)."""

    prompt = (
        "Rewrite the following text into English only.\n"
        "IMPORTANT:\n"
        "- Do NOT add new information.\n"
        "- Do NOT include any non-English text.\n"
        f"{preserve_format_hint}\n\n"
        f"TEXT:\n{text}\n\n"
        "ENGLISH REWRITE:"
    )
    return await worker_chat_full(
        worker_base_url=worker_base_url,
        messages=[
            {"role": "system", "content": _ENGLISH_ONLY_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        timeout_s=LLM_REQUEST_TIMEOUT_S,
    )


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
    messages = [
        {"role": "system", "content": _ENGLISH_ONLY_SYSTEM_PROMPT},
        {"role": "user", "content": user_query},
    ]

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
                    "prompt_tokens": resp.prompt_tokens,
                    "completion_tokens": resp.completion_tokens,
                    "total_tokens": resp.total_tokens,
                }
            )

    # Best-effort: if any model still output non-English scripts, ask it to rewrite in English.
    by_name = {w["name"]: w for w in council_workers}
    async def _maybe_rewrite(result: Dict[str, Any]):
        text = str(result.get("response", "") or "")
        if not _contains_non_english_script(text):
            return result
        w = by_name.get(result.get("model"))
        if not w:
            return result
        rewrite = await _rewrite_to_english_chat(
            worker_base_url=w["base_url"],
            text=text,
            preserve_format_hint="- Return ONLY the rewritten answer text (no extra headings).",
        )
        if rewrite is None:
            return result
        rewritten = str(rewrite.content or "").strip()
        if rewritten and not _contains_non_english_script(rewritten):
            # Update content and latency (best-effort sum).
            result["response"] = rewritten
            try:
                result["latency_ms"] = int(result.get("latency_ms") or 0) + int(rewrite.latency_ms or 0)
            except Exception:
                pass
            if (
                getattr(rewrite, "prompt_tokens", None) is not None
                or getattr(rewrite, "completion_tokens", None) is not None
                or getattr(rewrite, "total_tokens", None) is not None
            ):
                result["prompt_tokens"] = rewrite.prompt_tokens
                result["completion_tokens"] = rewrite.completion_tokens
                result["total_tokens"] = rewrite.total_tokens
            result["rewrite_applied"] = True
        return result

    if stage1_results:
        stage1_results = await asyncio.gather(*(_maybe_rewrite(r) for r in stage1_results))
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

    # If only one response exists, there's nothing meaningful to rank.
    if len(stage1_results) < 2:
        return [], label_to_model

    # Map worker name -> its own anonymous label (e.g., "Response B"), if present in Stage 1 results.
    model_to_label = {
        result["model"]: f"Response {label}"
        for label, result in zip(labels, stage1_results)
        if isinstance(result, dict) and result.get("model")
    }

    def _build_prompt_for_worker(worker_name: str) -> Tuple[str, List[str], str | None]:
        """
        Build a Stage 2 prompt that excludes the worker's own Stage 1 response (if any).
        Returns: (prompt, reviewed_labels, excluded_label)
        """
        excluded_label = model_to_label.get(worker_name)

        shown_pairs = [
            (label, result)
            for label, result in zip(labels, stage1_results)
            if f"Response {label}" != excluded_label
        ]
        reviewed_labels = [f"Response {label}" for label, _ in shown_pairs]

        responses_text = "\n\n".join(
            [f"Response {label}:\n{result.get('response', '')}" for label, result in shown_pairs]
        )

        valid_response_labels_text = ", ".join(reviewed_labels)
        example_evals = "\n".join(
            [f"- Response {label}: ... (brief critique here)" for label, _ in shown_pairs]
        )
        example_scores_lines = "\n".join(
            [f"Response {label} | accuracy=7 | insight=7 | total=14" for label, _ in shown_pairs]
        )
        example_ranking_lines = "\n".join(
            [f"{i}. Response {label}" for i, (label, _) in enumerate(shown_pairs, start=1)]
        )

        prompt = f"""You are evaluating different responses to the following question.

IMPORTANT: Your ENTIRE output MUST be in English only. Do not include any non-English characters or non-English quotes.

Question: {user_query}

Here are the responses from different models (anonymized). For fairness, your own response (if any) is NOT shown below.

{responses_text}

There are exactly {len(reviewed_labels)} responses: {valid_response_labels_text}

Your task:
1. First, provide an EVALUATION section (ALL CAPS) with ONE bullet per response.
   - Each bullet MUST start with "Response X:" and include 1–2 sentences about accuracy + insight strengths/weaknesses.
2. Then provide a SCORES section (ALL CAPS) with one line per response using EXACTLY this format:
   Response X | accuracy=<0-10 integer> | insight=<0-10 integer> | total=<0-20 integer>
   Where total MUST equal accuracy + insight.
3. Finally, provide FINAL RANKING (best to worst) based ONLY on total (higher is better).
   Tie-breakers if total is equal: higher accuracy, then higher insight, then keep the original response order.

IMPORTANT:
- Your EVALUATION section must cover ALL responses exactly once (no omissions, no extras).
- Your SCORES section must include ALL responses exactly once (no omissions, no extras).
- Your FINAL RANKING must include ONLY the responses listed above.
- Do NOT invent any additional responses.

Example of the correct format for your ENTIRE response:

EVALUATION:
{example_evals}

SCORES:
{example_scores_lines}

FINAL RANKING:
{example_ranking_lines}

Now provide your evaluation, SCORES, and FINAL RANKING:"""

        return prompt, reviewed_labels, excluded_label

    council_workers = _get_council_workers()
    # Query each worker with a customized prompt (exclude its own Stage 1 response if present).
    async def _rank_one(w: Dict[str, str]):
        prompt, reviewed_labels, excluded_label = _build_prompt_for_worker(w["name"])
        resp = await worker_chat_full(
            worker_base_url=w["base_url"],
            messages=[
                {"role": "system", "content": _ENGLISH_ONLY_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            timeout_s=LLM_REQUEST_TIMEOUT_S,
        )
        # Best-effort rewrite if model used non-English scripts.
        if resp is not None and _contains_non_english_script(str(resp.content or "")):
            rewrite = await _rewrite_to_english_chat(
                worker_base_url=w["base_url"],
                text=str(resp.content or ""),
                preserve_format_hint=(
                    "- Preserve the exact section headers: EVALUATION:, SCORES:, FINAL RANKING:.\n"
                    "- Preserve the same Response labels (e.g., Response A/B/...).\n"
                    "- Keep the same numeric scores and ranking order."
                ),
            )
            if rewrite is not None and rewrite.content:
                resp = rewrite
        return w, resp, reviewed_labels, excluded_label

    results = await asyncio.gather(*(_rank_one(w) for w in council_workers))

    stage2_results: List[Dict[str, Any]] = []
    for w, resp, reviewed_labels, excluded_label in results:
        if resp is None:
            continue
        content = resp.content
        parsed = _sanitize_parsed_ranking(
            parse_ranking_from_text(content),
            valid_labels=reviewed_labels,
        )
        parsed_scores_all = parse_scores_from_text(content)
        parsed_scores = {k: v for k, v in parsed_scores_all.items() if k in set(reviewed_labels)}
        stage2_results.append(
            {
                "model": w["name"],
                "ranking": content,
                "parsed_ranking": parsed,
                "parsed_scores": parsed_scores,
                "latency_ms": resp.latency_ms,
                "ollama_model": resp.model,
                "prompt_tokens": resp.prompt_tokens,
                "completion_tokens": resp.completion_tokens,
                "total_tokens": resp.total_tokens,
                # For downstream aggregation/UI (exclude-self + partial rankings).
                "reviewed_labels": reviewed_labels,
                "excluded_label": excluded_label,
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
            "error": True,
            "error_type": "chairman_unreachable",
        }

    # Best-effort: ensure English-only output.
    if _contains_non_english_script(str(synth.response or "")):
        rewrite_query = (
            "Rewrite the DRAFT ANSWER below into English only.\n"
            "IMPORTANT:\n"
            "- Output ONLY the rewritten answer.\n"
            "- Do NOT add new information.\n"
            "- Do NOT include any non-English text.\n\n"
            f"DRAFT ANSWER:\n{synth.response}"
        )
        rewrite = await worker_synthesize_full(
            chairman_base_url=chairman["base_url"],
            user_query=rewrite_query,
            stage1=[],
            stage2=[],
            timeout_s=LLM_REQUEST_TIMEOUT_S,
        )
        if rewrite is not None and rewrite.response and not _contains_non_english_script(str(rewrite.response)):
            return {
                "model": chairman["name"],
                "response": rewrite.response,
                "latency_ms": int(synth.latency_ms or 0) + int(rewrite.latency_ms or 0),
                "prompt_tokens": rewrite.prompt_tokens,
                "completion_tokens": rewrite.completion_tokens,
                "total_tokens": rewrite.total_tokens,
                "rewrite_applied": True,
            }

    return {
        "model": chairman["name"],
        "response": synth.response,
        "latency_ms": synth.latency_ms,
        "prompt_tokens": synth.prompt_tokens,
        "completion_tokens": synth.completion_tokens,
        "total_tokens": synth.total_tokens,
    }


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


def parse_scores_from_text(ranking_text: str) -> Dict[str, Dict[str, Any]]:
    """Parse the SCORES section into a mapping: {"Response A": {accuracy, insight, total, ...}, ...}."""

    import re

    text = str(ranking_text or "")
    # Prefer parsing between "SCORES:" and "FINAL RANKING:" (case-insensitive), but be tolerant if the
    # model omits the "SCORES:" header and still outputs score lines.
    scores_hdr = re.search(r"\bSCORES:\s*", text, re.IGNORECASE)
    after = text[scores_hdr.end():] if scores_hdr else text

    final_hdr = re.search(r"\bFINAL RANKING:\s*", after, re.IGNORECASE)
    if final_hdr:
        after = after[: final_hdr.start()]

    # Be tolerant to small formatting deviations, e.g. extra explanations after numbers:
    # "Response B | accuracy=8 (because...) | insight=6 (...) | total=14"
    pattern = re.compile(
        r"Response\s+([A-Z])\s*\|\s*accuracy\s*[:=]\s*(\d{1,2})(?:\s*/\s*10)?\b[^|]*\|\s*insight\s*[:=]\s*(\d{1,2})(?:\s*/\s*10)?\b[^|]*\|\s*total\s*[:=]\s*(\d{1,2})(?:\s*/\s*20)?\b",
        re.IGNORECASE,
    )

    scores: Dict[str, Dict[str, Any]] = {}
    for m in pattern.finditer(after):
        label = f"Response {m.group(1).upper()}"
        if label in scores:
            continue  # keep first occurrence

        try:
            accuracy = int(m.group(2))
            insight = int(m.group(3))
            total_reported = int(m.group(4))
        except Exception:
            continue

        accuracy = max(0, min(10, accuracy))
        insight = max(0, min(10, insight))
        total_expected = accuracy + insight
        total = max(0, min(20, total_expected))

        scores[label] = {
            "accuracy": accuracy,
            "insight": insight,
            "total": total,
            "total_reported": total_reported,
            "total_ok": total_reported == total_expected,
        }

    return scores


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

    # Track positions for each model (lower is better).
    model_positions = defaultdict(list)
    all_valid_labels = set(label_to_model.keys())

    for ranking in stage2_results:
        parsed_ranking = ranking.get("parsed_ranking")
        if not isinstance(parsed_ranking, list) or not parsed_ranking:
            ranking_text = ranking.get("ranking", "")
            parsed_ranking = parse_ranking_from_text(str(ranking_text))

        # If the reviewer did not see all responses (exclude-self), only count votes
        # for the labels that were actually shown to that reviewer.
        reviewed_labels = ranking.get("reviewed_labels")
        if isinstance(reviewed_labels, list) and reviewed_labels:
            valid_set = {str(x) for x in reviewed_labels if str(x) in all_valid_labels}
        else:
            valid_set = all_valid_labels

        # Filter out hallucinated labels & duplicates, but DO NOT append missing labels here.
        # Missing labels represent "no vote" for that reviewer in the exclude-self setup.
        seen = set()
        cleaned: List[str] = []
        for label in parsed_ranking:
            s = str(label)
            if s in valid_set and s not in seen:
                cleaned.append(s)
                seen.add(s)

        for position, label in enumerate(cleaned, start=1):
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


def calculate_aggregate_scores(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Aggregate accuracy/insight/total scores across all peer evaluations."""

    from collections import defaultdict

    sums = defaultdict(lambda: {"acc": 0.0, "ins": 0.0, "total": 0.0, "count": 0})
    all_valid_labels = set(label_to_model.keys())

    for entry in stage2_results:
        reviewed_labels = entry.get("reviewed_labels")
        if isinstance(reviewed_labels, list) and reviewed_labels:
            valid_set = {str(x) for x in reviewed_labels if str(x) in all_valid_labels}
        else:
            valid_set = all_valid_labels

        parsed_scores = entry.get("parsed_scores")
        if not isinstance(parsed_scores, dict) or not parsed_scores:
            parsed_scores = parse_scores_from_text(str(entry.get("ranking", "")))

        if not isinstance(parsed_scores, dict):
            continue

        for label, score in parsed_scores.items():
            if label not in valid_set:
                continue
            if label not in label_to_model:
                continue
            if not isinstance(score, dict):
                continue

            try:
                acc = float(score.get("accuracy"))
                ins = float(score.get("insight"))
                tot = float(score.get("total"))
            except Exception:
                continue

            model_name = label_to_model[label]
            s = sums[model_name]
            s["acc"] += acc
            s["ins"] += ins
            s["total"] += tot
            s["count"] += 1

    aggregate: List[Dict[str, Any]] = []
    for model, s in sums.items():
        if s["count"] <= 0:
            continue
        n = float(s["count"])
        aggregate.append(
            {
                "model": model,
                "average_accuracy": round(s["acc"] / n, 2),
                "average_insight": round(s["ins"] / n, 2),
                "average_total": round(s["total"] / n, 2),
                "scores_count": int(s["count"]),
            }
        )

    # Sort best to worst (higher total is better), then accuracy, then insight.
    aggregate.sort(
        key=lambda x: (-x["average_total"], -x["average_accuracy"], -x["average_insight"], str(x["model"]))
    )
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

    messages = [
        {"role": "system", "content": _ENGLISH_ONLY_SYSTEM_PROMPT},
        {"role": "user", "content": title_prompt},
    ]
    content = await worker_chat(
        worker_base_url=title_worker["base_url"],
        messages=messages,
        timeout_s=TITLE_REQUEST_TIMEOUT_S,
    )
    if content is None:
        return "New Conversation"

    title = content.strip()
    # Best-effort rewrite if the model produced non-English scripts.
    if _contains_non_english_script(title):
        rewrite = await _rewrite_to_english_chat(
            worker_base_url=title_worker["base_url"],
            text=title,
            preserve_format_hint="- Return a concise 3–5 word English title only (no quotes, no punctuation).",
        )
        if rewrite is not None and rewrite.content:
            candidate = str(rewrite.content).strip()
            if candidate and not _contains_non_english_script(candidate):
                title = candidate

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
    # Normalize query for LLMs (English-only output constraint)
    user_query = await normalize_user_query_to_english(user_query)

    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "Error: All models failed to respond. Please try again.",
            "error": True,
            "error_type": "stage1_no_responses",
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)

    # Calculate aggregate rankings
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
    aggregate_scores = calculate_aggregate_scores(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings,
        "aggregate_scores": aggregate_scores,
    }

    return stage1_results, stage2_results, stage3_result, metadata
