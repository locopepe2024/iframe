from __future__ import annotations

from typing import Any, Literal


WritingMode = Literal["expand_outline", "continue"]


def build_episode_writing_messages(
    *,
    mode: WritingMode,
    title: str,
    source_text: str,
    target_word_count: int,
    series_context: str = "",
    previous_episode_context: str = "",
    instruction: str = "",
    skill_instructions: str = "",
) -> list[dict[str, str]]:
    system = (
        "你是 GreenA 剧本写作助手。只输出可直接编辑的中文剧本正文，不输出分析过程、前言、总结或 Markdown 代码围栏。"
        "优先遵守用户明确要求、当前分集标题和原稿事实。剧本格式使用场景标题、可见动作、角色名和对白；"
        "不把作者设定直接改写成角色说明性台词。"
        "写作长度以字数控制，中文按非空白字符（含标点）估算；以约定字数为目标自然完成情节。"
        "成片目标时长由后续导演分析与分镜阶段安排，不按字数固定换算。"
    )
    if mode == "expand_outline":
        if skill_instructions:
            system += "\n\n单集大纲扩写技能：\n" + skill_instructions
        task = (
            f"请把当前单集大纲扩写成约 {target_word_count} 字、完整可拍摄的剧本正文。"
            "保留本集既定事件、角色动机、事件顺序和结尾状态；不得替换集标题，不提前兑现后续集秘密。"
            "补足场景、行动因果、必要反应和对白，让每个大纲事件都能在正文中找到对应位置。"
        )
    else:
        task = (
            f"请从现有剧本结尾继续写约 {target_word_count} 字的后续正文。只输出新增内容，不重复已有段落；"
            "承接人物状态、场景、道具和已经发生的事件，不擅自改写原稿或提前兑现后续剧情。"
        )
    constraints = [
        f"当前分集标题：{title.strip() or '未命名剧本'}",
        f"本集正文目标字数：约 {target_word_count} 字" if mode == "expand_outline" else f"本次新增目标字数：约 {target_word_count} 字",
    ]
    if series_context.strip():
        constraints.append("系列设定与创作约束（优先作为全局事实）：\n" + series_context.strip())
    if previous_episode_context.strip():
        constraints.append("上一集结尾与承接状态：\n" + previous_episode_context.strip())
    if instruction.strip():
        constraints.append("本次写作补充要求：\n" + instruction.strip()[:4000])
    user = "\n\n".join([
        task,
        *constraints,
        "当前分集原稿：\n<episode_source>\n" + source_text.strip() + "\n</episode_source>",
    ])
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def generate_episode_text(llm: Any, *, model: str | None = None, **kwargs: Any) -> dict[str, str]:
    messages = build_episode_writing_messages(**kwargs)
    options = {"model": model} if model else {}
    draft = llm.chat(messages=messages, timeout_seconds=900, max_retries=1, stream=True, **options).strip()
    if draft.startswith("```"):
        draft = draft.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    if not draft:
        raise RuntimeError("写作模型没有返回剧本正文，请重试")
    return {"draft": draft, "mode": kwargs["mode"], "title": kwargs["title"]}


def generate_passage_rewrite(
    llm: Any, *, title: str, selected_text: str, instruction: str,
    before_text: str = "", after_text: str = "", model: str | None = None,
) -> dict[str, str]:
    """Rewrite a bounded selection, including unsaved writing-preview passages.

    The caller owns the source/range and decides whether to adopt the proposal.
    Never resolve a whole episode or outline here: it would replace that scope.
    """
    messages = [
        {"role": "system", "content": (
            "你是 GreenA 剧本局部修改助手。按用户意见修改选中片段，保持人物事实、视角、时态和剧本风格。"
            "前后文仅用于衔接，不是改写范围。不得复述前后文，不续写整集，不改写未选中内容。"
            "只输出选中片段的替换正文，不输出解释、标题标签、分析过程或 Markdown 代码围栏。"
            "除非修改意见明确要求改变长度，保持与原片段相近的篇幅。"
        )},
        {"role": "user", "content": "\n\n".join([
            "剧本标题：" + title,
            "修改意见：\n" + instruction,
            "前文（只读衔接参考）：\n<before>\n" + before_text + "\n</before>",
            "选中片段（仅替换此处）：\n<selection>\n" + selected_text + "\n</selection>",
            "后文（只读衔接参考）：\n<after>\n" + after_text + "\n</after>",
            "只输出选中片段的替换正文。",
        ])},
    ]
    options = {"model": model} if model else {}
    draft = llm.chat(messages=messages, timeout_seconds=900, max_retries=1, stream=True, **options).strip()
    if draft.startswith("```"):
        draft = draft.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    if not draft:
        raise RuntimeError("写作模型没有返回修改正文，请重试")
    return {"draft": draft, "mode": "rewrite", "title": title}
