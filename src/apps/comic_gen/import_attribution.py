"""Source-grounded attribution for mixed series submissions."""

import json
import re
from typing import Any

from .llm import _episode_number


_EPISODE_LIKE_LINE = re.compile(
    r"(?m)^[ \t]*(?:#{1,6}[ \t]+)?第[ \t]*(\d{1,3}|[一二三四五六七八九十百零两]+)[ \t]*集(?=[ \t\u3000：:、.．·\-—－])"
)


def needs_attribution(text: str, recognized_count: int) -> bool:
    return len(_EPISODE_LIKE_LINE.findall(text)) > recognized_count


def episode_count_hint(text: str) -> int:
    return max((_episode_number(match.group(1)) for match in _EPISODE_LIKE_LINE.finditer(text)), default=0)


def _lines(text: str) -> list[tuple[int, int, str]]:
    result = []
    offset = 0
    for line in text.splitlines(keepends=True):
        result.append((offset, offset + len(line), line))
        offset += len(line)
    return result


def validate_assignments(text: str, assignments: list[dict[str, Any]],
                         episode_count: int) -> list[dict[str, Any]]:
    """Validate a complete partition; offsets always come from the source."""
    lines = _lines(text)
    if not isinstance(assignments, list) or not assignments:
        raise ValueError("原文段落归属不完整；请重新分析")
    result = []
    next_line = 1
    for item in assignments:
        if not isinstance(item, dict):
            raise ValueError("原文段落归属无效；请重新分析")
        start, end = item.get("start_line"), item.get("end_line")
        scope, episodes = item.get("scope"), item.get("episodes", [])
        if (type(start) is not int or type(end) is not int or start != next_line
                or end < start or end > len(lines)):
            raise ValueError("原文段落归属不完整或重叠；请重新分析")
        if (not isinstance(episodes, list) or any(type(n) is not int or n < 1 or n > episode_count for n in episodes)
                or len(episodes) != len(set(episodes))):
            raise ValueError("分集归属编号无效；请重新分析")
        if scope not in ("series", "episode", "unassigned") or (scope == "episode") != bool(episodes):
            raise ValueError("原文段落归属无效；请重新分析")
        result.append({
            "start_line": start,
            "end_line": end,
            "start_offset": lines[start - 1][0],
            "end_offset": lines[end - 1][1],
            "scope": scope,
            "episodes": episodes,
            "preview": "".join(line[2] for line in lines[start - 1:end]).strip()[:120],
            "source": text[lines[start - 1][0]:lines[end - 1][1]],
        })
        next_line = end + 1
    if next_line != len(lines) + 1:
        raise ValueError("原文段落归属不完整；请重新分析")
    return result


def materialize(text: str, assignments: list[dict[str, Any]],
                episode_count: int) -> tuple[str, list[str], list[dict[str, Any]]]:
    checked = validate_assignments(text, assignments, episode_count)
    if any(item["scope"] == "unassigned" for item in checked):
        raise ValueError("仍有未分配原文段落；请先指定归属")
    chunks = [[] for _ in range(episode_count)]
    series = []
    for item in checked:
        source = text[item["start_offset"]:item["end_offset"]]
        if item["scope"] == "series":
            series.append(source)
        else:
            for number in item["episodes"]:
                chunks[number - 1].append(source)
    if any(not "".join(chunk).strip() for chunk in chunks):
        raise ValueError("部分分集缺少原文内容；请检查段落归属")
    return "".join(series), ["".join(chunk) for chunk in chunks], checked


def analyze_attribution(llm: Any, text: str, episode_count: int) -> dict[str, Any]:
    lines = _lines(text)
    if len(text) > 80000:
        raise ValueError("混合结构原文超过 80,000 字符；请分段导入，避免遗漏详细剧情")
    indexed = "\n".join(f"[{i}] {line[2].rstrip()}" for i, line in enumerate(lines, 1))
    prompt = f"""你是剧本文档整理助手。只判定原文段落归属，不改写、补写或删除剧情。
目标集数：{episode_count}。文档可能混合全剧规则、角色资料、详细分集剧情和标题速览。
每行且仅一次归入 series（全剧规则、跨集资料、速览、制作备注）、episode（具体集剧情，可属于多个集）或 unassigned（无法确定）。
角色背景可以归属相关的多集。详细分集剧情必须归入对应集；标题速览不能替代详细剧情。没有把握就用 unassigned。
仅输出 JSON：{{"episodes":[{{"episode_number":1,"title":"简短标题","summary":"依据原文的摘要"}}],"assignments":[{{"start_line":1,"end_line":3,"scope":"series","episodes":[]}}]}}。
episodes 必须是连续 1 至 {episode_count}；assignments 必须顺序覆盖第 1 至 {len(lines)} 行、不重叠、不跳行。
原文：
{indexed}"""
    content = llm.chat(messages=[{"role": "user", "content": prompt}]).strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    data = json.loads(content)
    episodes = data.get("episodes")
    if (not isinstance(episodes, list) or len(episodes) != episode_count
            or any(not isinstance(item, dict) for item in episodes)
            or [item.get("episode_number") for item in episodes] != list(range(1, episode_count + 1))):
        raise ValueError("导演归属分析返回的分集编号无效；请重新分析")
    assignments = validate_assignments(text, data.get("assignments", []), episode_count)
    return {"episodes": [
        {"episode_number": item["episode_number"], "title": str(item.get("title") or f"第{item['episode_number']}集")[:100],
         "summary": str(item.get("summary") or "")[:200]}
        for item in episodes
    ], "assignments": assignments}
