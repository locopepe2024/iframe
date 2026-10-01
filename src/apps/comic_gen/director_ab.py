"""Offline scoring helpers for Director source-mode A/B runs.

The scorer is deliberately conservative: it measures whether expected
source-linked terms are present in the returned structured profile. It does
not claim semantic correctness from string presence alone.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List
import json


def _flatten(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def score_profile(profile: Dict[str, Any], gold: Dict[str, Any]) -> Dict[str, Any]:
    """Return coverage and unsupported-reference metrics for one profile."""
    rendered = _flatten(profile)

    def coverage(items: Iterable[str]) -> Dict[str, Any]:
        expected = [str(item) for item in items if str(item).strip()]
        found = [item for item in expected if item in rendered]
        return {
            "expected": len(expected),
            "found": len(found),
            "rate": (len(found) / len(expected)) if expected else 1.0,
            "missing": [item for item in expected if item not in found],
        }

    unresolved = profile.get("unresolved_character_refs", [])
    if not isinstance(unresolved, list):
        unresolved = []
    unresolved += profile.get("unresolved_person_refs", []) if isinstance(profile.get("unresolved_person_refs"), list) else []
    return {
        "event_coverage": coverage(gold.get("events", [])),
        "character_coverage": coverage(gold.get("characters", [])),
        "relationship_coverage": coverage(gold.get("relationships", [])),
        "scene_coverage": coverage(gold.get("scenes", [])),
        "thread_coverage": coverage(gold.get("threads", [])),
        "unresolved_reference_count": len(unresolved),
        "profile_key_count": len(profile),
    }


def compare_profiles(
    direct: Dict[str, Any], digest: Dict[str, Any], gold: Dict[str, Any]
) -> Dict[str, Any]:
    """Score two profiles and expose metric deltas (direct minus digest)."""
    direct_score = score_profile(direct, gold)
    digest_score = score_profile(digest, gold)
    delta: Dict[str, Any] = {}
    for key, value in direct_score.items():
        if isinstance(value, dict) and "rate" in value:
            delta[key] = round(value["rate"] - digest_score[key]["rate"], 6)
        elif isinstance(value, (int, float)):
            delta[key] = value - digest_score[key]
    return {"direct": direct_score, "digest": digest_score, "delta_direct_minus_digest": delta}
