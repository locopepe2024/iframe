"""Source-grounded attribution for mixed series submissions."""

import json
import re
from typing import Any

from .llm import _episode_number


_EPISODE_LIKE_LINE = re.compile(
    r"(?m)^[ \t]*(?:#{1,6}[ \t]+)?第[ \t]*(\d{1,3}|[一二三四五六七八九十百零两]+)[ \t]*集(?=[ \t\u3000：:、.．·\-—－])"
)
_GROUP_HEADING = re.compile(r"^[^（）()\n]{1,100}[（(]第\s*(\d{1,3})\s*[—–-]\s*(\d{1,3})\s*集[）)]")
_DETAIL_LINE = re.compile(r"^第\s*(\d{1,3})\s*集[·：:]")
_SHARED_GROUP_CONTEXT = re.compile(r"^(?:原著锚点|角色锚点|人物设定|场景设定)\s*[：:]")
_GROUP_OPENING = re.compile(r"^月读牢笼\s*[：:]")
_OVERVIEW_SECTION = re.compile(r"^[一二三四五六七八九十]+[、.]\s*\d+\s*集分集标题速览")
_OVERVIEW_LINE = re.compile(r"^第\s*(\d{1,3})\s*集(?=[ \t\u3000：:、.．·\-—－])")
_SECTION_HEADING = re.compile(r"^[一二三四五六七八九十]+[、.]")
_TAIL_EPISODE_LINE = re.compile(r"^第\s*(\d{1,3})\s*集(?:结尾|最后|片尾|片头|开头)")


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


def structured_assignments(text: str, episode_count: int) -> list[dict[str, Any]] | None:
    """Assign a complete paired-character outline only when its structure is unambiguous."""
    lines = _lines(text)
    overview = [index for index, (_, _, line) in enumerate(lines)
                if _OVERVIEW_SECTION.match(line.strip())]
    if len(overview) != 1 or episode_count < 2:
        return None
    overview_start = overview[0]
    groups = [(index, int(match.group(1)), int(match.group(2)))
              for index, (_, _, line) in enumerate(lines[:overview_start])
              if (match := _GROUP_HEADING.match(line.strip()))]
    if not groups or groups[0][1] != 1 or groups[-1][2] != episode_count:
        return None
    next_number = 1
    for _, first, last in groups:
        if first != next_number or last != first + 1 or last > episode_count:
            return None
        next_number = last + 1

    overview_end = next((index for index in range(overview_start + 1, len(lines))
                         if _SECTION_HEADING.match(lines[index][2].strip())), len(lines))
    overview_numbers = [int(match.group(1))
                        for _, _, line in lines[overview_start + 1:overview_end]
                        if (match := _OVERVIEW_LINE.match(line.strip()))]
    if overview_numbers != list(range(1, episode_count + 1)):
        return None

    owners: list[tuple[str, tuple[int, ...]]] = [("series", ()) for _ in lines]
    for group_index, (start_line, first, last) in enumerate(groups):
        end_line = groups[group_index + 1][0] if group_index + 1 < len(groups) else overview_start
        group_numbers = tuple(range(first, last + 1))
        detailed: set[int] = set()
        for index in range(start_line, end_line):
            line = lines[index][2].strip()
            if not line or re.fullmatch(r"[—\-─]{3,}", line):
                continue
            detail = _DETAIL_LINE.match(line)
            if detail:
                number = int(detail.group(1))
                if number not in group_numbers:
                    return None
                detailed.add(number)
                owners[index] = ("episode", (number,))
            elif index == start_line or _SHARED_GROUP_CONTEXT.match(line):
                owners[index] = ("episode", group_numbers)
            elif _GROUP_OPENING.match(line):
                owners[index] = ("episode", (first,))
        if detailed != set(group_numbers):
            return None

    for index in range(overview_end, len(lines)):
        detail = _TAIL_EPISODE_LINE.match(lines[index][2].strip())
        if detail and 1 <= int(detail.group(1)) <= episode_count:
            owners[index] = ("episode", (int(detail.group(1)),))

    assignments: list[dict[str, Any]] = []
    for line_number, (scope, episodes) in enumerate(owners, 1):
        if assignments and assignments[-1]["scope"] == scope and assignments[-1]["episodes"] == list(episodes):
            assignments[-1]["end_line"] = line_number
        else:
            assignments.append({"start_line": line_number, "end_line": line_number,
                                "scope": scope, "episodes": list(episodes)})
    return validate_assignments(text, assignments, episode_count)


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


def analyze_attribution(llm: Any, text: str, episode_count: int, *,
                        fixed_assignments: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    lines = _lines(text)
    if len(text) > 80000:
        raise ValueError("混合结构原文超过 80,000 字符；请分段导入，避免遗漏详细剧情")
    indexed = "\n".join(f"[{i}] {line[2].rstrip()}" for i, line in enumerate(lines, 1))
    if fixed_assignments is not None:
        assignments = validate_assignments(text, fixed_assignments, episode_count)
        source_map = [{key: item[key] for key in ("start_line", "end_line", "scope", "episodes")}
                      for item in assignments]
        prompt = f"""你是剧本文档整理助手。原文段落归属已由程序确定，不需要重新判定段落归属。
根据分集标题速览为第 1 至 {episode_count} 集提供简短标题，并根据该集已归属的详细剧情提供摘要。
全剧资料只作背景，不能代替该集实际发生的事件；不要补写原文没有的剧情。
仅输出 JSON：{{"episodes":[{{"episode_number":1,"title":"简短标题","summary":"依据该集原文的摘要"}}]}}。
episodes 必须是连续 1 至 {episode_count}。段落归属：{json.dumps(source_map, ensure_ascii=False)}
原文：
{indexed}"""
    else:
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
    assignments = (validate_assignments(text, data.get("assignments", []), episode_count)
                   if fixed_assignments is None else assignments)
    return {"episodes": [
        {"episode_number": item["episode_number"], "title": str(item.get("title") or f"第{item['episode_number']}集")[:100],
         "summary": str(item.get("summary") or "")[:200]}
        for item in episodes
    ], "assignments": assignments}
