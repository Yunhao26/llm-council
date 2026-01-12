import argparse
import sys
from typing import Any, Dict, List

import httpx
import re
import codecs

_NON_ENGLISH_RE = re.compile(r"[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF]")


def _contains_non_english_script(text: str) -> bool:
    return bool(_NON_ENGLISH_RE.search(str(text or "")))


def _short(obj: Any, limit: int = 120) -> str:
    s = str(obj)
    if len(s) <= limit:
        return s
    return s[: limit - 3] + "..."


def main() -> int:
    parser = argparse.ArgumentParser(description="LLM Council smoke test (Stage 2 scoring + exclude-self).")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001", help="Orchestrator base URL")
    parser.add_argument(
        "--prompt",
        default="Return exactly the string OK and nothing else.",
        help="User prompt to run through the 3-stage pipeline",
    )
    parser.add_argument("--timeout-s", type=float, default=180.0, help="HTTP timeout (seconds)")
    parser.add_argument("--min-stage1", type=int, default=2, help="Minimum required Stage 1 responses")
    parser.add_argument("--require-english", action="store_true", help="Fail if any stage output contains non-English scripts")
    parser.add_argument(
        "--decode-unicode-escapes",
        action="store_true",
        help="Decode \\uXXXX sequences in --prompt (useful on shells that struggle with Unicode arguments).",
    )
    args = parser.parse_args()

    if args.decode_unicode_escapes and isinstance(args.prompt, str):
        # Turn a literal "\\u4e2d\\u6587" argument into actual Unicode text "中文"
        args.prompt = codecs.decode(args.prompt, "unicode_escape")

    base = args.base_url.rstrip("/")

    with httpx.Client(timeout=args.timeout_s) as c:
        conv = c.post(f"{base}/api/conversations", json={}).json()
        cid = conv.get("id")
        if not cid:
            print("FAIL: /api/conversations did not return an id:", conv)
            return 1

        resp = c.post(f"{base}/api/conversations/{cid}/message", json={"content": args.prompt}).json()

    stage1: List[Dict[str, Any]] = resp.get("stage1") or []
    stage2: List[Dict[str, Any]] = resp.get("stage2") or []
    stage3: Dict[str, Any] = resp.get("stage3") or {}
    meta: Dict[str, Any] = resp.get("metadata") or {}

    print(f"conversation_id: {cid}")
    print(f"stage1_count: {len(stage1)}")
    print(f"stage2_count: {len(stage2)}")
    print(f"stage3_model: {_short(stage3.get('model'))}")
    print(f"stage3_error: {bool(stage3.get('error'))}")

    label_to_model: Dict[str, str] = meta.get("label_to_model") or {}
    model_to_label = {v: k for k, v in label_to_model.items()}

    problems: List[str] = []
    if len(stage1) < int(args.min_stage1):
        problems.append(f"stage1 has <{args.min_stage1} responses: {len(stage1)}")
    if not stage2:
        problems.append("stage2 is empty")

    print("\n--- stage2 reviewers ---")
    for r in stage2:
        reviewer = r.get("model")
        excluded = r.get("excluded_label")
        reviewed = r.get("reviewed_labels") or []
        scores = r.get("parsed_scores") or {}
        print(
            {
                "reviewer": reviewer,
                "excluded_label": excluded,
                "reviewed_labels": reviewed,
                "parsed_scores_labels": list(scores.keys()),
            }
        )

        expected_excluded = model_to_label.get(reviewer)
        if expected_excluded and excluded != expected_excluded:
            problems.append(
                f"excluded_label mismatch for reviewer={reviewer}: got={excluded}, expected={expected_excluded}"
            )
        if expected_excluded and expected_excluded in reviewed:
            problems.append(f"self label included in reviewed_labels for reviewer={reviewer}: {expected_excluded}")
        for k in scores.keys():
            if k not in reviewed:
                problems.append(f"parsed_scores includes unseen label for reviewer={reviewer}: {k}")

    agg_scores = meta.get("aggregate_scores") or []
    agg_rankings = meta.get("aggregate_rankings") or []
    print("\n--- metadata ---")
    print(f"label_to_model_count: {len(label_to_model)}")
    print(f"aggregate_scores_count: {len(agg_scores)}")
    print(f"aggregate_rankings_count: {len(agg_rankings)}")

    if not agg_scores:
        problems.append("metadata.aggregate_scores missing/empty")
    if not agg_rankings:
        problems.append("metadata.aggregate_rankings missing/empty")

    if args.require_english:
        for r in stage1:
            model = r.get("model")
            text = r.get("response", "")
            if _contains_non_english_script(str(text)):
                problems.append(f"stage1 non-English script detected for model={model}")

        for r in stage2:
            reviewer = r.get("model")
            text = r.get("ranking", "")
            if _contains_non_english_script(str(text)):
                problems.append(f"stage2 non-English script detected for reviewer={reviewer}")

        s3 = stage3.get("response", "")
        if _contains_non_english_script(str(s3)):
            problems.append("stage3 non-English script detected")

    print("\n--- result ---")
    if problems:
        print("FAIL")
        for p in problems:
            print("-", p)
        return 1

    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

