"""Checkpointed Director understanding; intermediate steps never become user drafts."""
import hashlib
import json

VERSION = "director-profile-stages-v2"
STAGES = (
    ("source", "来源整理", ()),
    ("foundation", "基础设定", (
        "setting", "emotional_arc", "pacing", "visual_language", "performance_direction",
        "dialogue_direction", "sound_direction", "prohibitions", "unresolved_questions", "sample_plan")),
    ("story", "故事结构", ("timeline", "relationships", "key_events", "story_map")),
    ("continuity", "场景连续性与执行摘要", (
        "scene_summaries", "canon_state", "continuity_constraints", "execution_summary")),
)
# A source-backed Director interpretation is not a second screenplay. Bound
# individual responses as well as prompts, without truncating accepted facts.
MAX_RESPONSE_CHARS = 24000
GUIDANCE = {
    "foundation": (
        "仅整理背景、情绪、节奏和视听表演方向，不展开事件表、故事地图、逐场连续性。"
        "setting 最多6个键；方向文本各最多240字；prohibitions/unresolved_questions各最多8条，"
        "每条最多120字；sample_plan最多4项。只记录影响故事的真实疑问，不为填字段制造问题。"),
    "story": (
        "仅生成 timeline、relationships、key_events、story_map；前三项各最多8项，每项简洁。"
        "区分剧情发生顺序与剧本呈现顺序，保留回忆、并行事件及明确的时间跳跃。"
        "story_map 必须为对象，含 schema_version=1、phases、relationship_arcs、story_threads。"
        "按叙事因果合并事件，不逐句展开；最多8个phase、16个event、8条relationship arc、4条story thread。"
        "description/dramatic_function/note/关系状态各最多80字。"
        "phase_id、event_id、relationship_id、thread_id 在本结果内唯一且非空。"
        "人物用 character_refs/person_refs 字符串数组引用原文名称，内部ID由服务端绑定。"
        "所有 source_fact_ids=[]；evidence_status仅 interpretation/uncertain/conflicted，不能伪装已确认事实。"
        "关系 states 使用实际phase_id，trigger_event_ids使用实际event_id；只有文字关系时用legacy_summary，states=[]。"
        "milestones是对象数组，每项event_id指向实际事件，role只能 setup/progress/turn/reveal/payoff/open/close。"
        "有事件就至少有一条主线，不得用timeline代替story_map。"
        "Series全剧分析允许story_map中三组数组为空，不将全剧结局当作本集事件。"),
    "continuity": (
        "仅核对场景连续性并形成执行摘要，不重新生成前两步。"
        "scene_summaries最多16项，每项仅含scene_ref、summary、state_in、state_out、location、"
        "time_anchor、daylight_phase、lighting_cues。scene_ref必须可回指原文；summary最多64字，"
        "state_in/state_out各最多48字；其余各最多80字。有可定位事件就至少一项场景候选。"
        "不要把来源分块当作叙事场景，场景候选也不是资产实体或拍摄场次。"
        "仅记录有证据的地点、时段、自然光及画内光源；创意灯光标为导演解释。"
        "state_out与下一场state_in保留原文支持的变化；相同时段名称不能证明连续。"
        "同名地点不能证明同址；只有空间指代、地标或连续移动等来源证据才支持合并。"
        "跨场和非相邻场的时空、人物、道具承接须有证据；未知关系保留待核验，不生成连续性ID。"
        "continuity_constraints最多8条，每条120字。canon_state是分类对象，不是事实平铺数组；"
        "分类为characters/relationships/world_rules/timeline/events/open_threads/conflicts/uncertainties，"
        "总共最多20条事实，每条简短，尽量带source_refs；未知事实不可标active。"
        "execution_summary汇总前两步及本步骤，是后续制作的简洁入口，最多20条、2000字符；"
        "区分剧本事实、导演解释、用户要求，不复制完整事件表或剧本。"),
}

# Keep user-selected analysis methods in the steps that can emit their findings.
# Fail closed for new catalog methods until their step assignment is deliberate.
METHOD_STEPS = {
    "people-relations": ("story",),
    "story-causality": ("story",),
    "episode-beats": ("foundation", "story"),
    "continuity-review": ("continuity",),
    "setup-payoff-review": ("story",),
    "dialogue-review": ("foundation",),
}


def build_step_prompt(key, source_context, is_digest, entities, style, profile):
    """Build a scoped request without full-profile/extraction preset baggage."""
    from src.apps.director_skills import guidance
    from .llm import _director_profile_output_contract, _prompt_json
    from .models import director_execution_payload

    _, label, fields = next(stage for stage in STAGES[1:] if stage[0] == key)
    series = entities.get("scope") == "series"
    scope = ("Series 全剧导演理解：梗概描述全剧走向，分集剧本描述各集实际事件，不把结局当作首集事实。"
             if series else "Episode 分集导演理解：只分析本集实际发生的事件、人物和地点。")
    parts = [
        "你是电影导演和剧本统筹。当前独立步骤：" + label,
        scope,
        "原文是事实依据；区分剧本事实、导演解释、用户要求与未决问题。"
        "不改写剧本，不编造对白、事件、人物动机或文化背景。"
        "只有影响故事且来源充分覆盖后仍有歧义的问题才列为未决；未提及不等于缺失。",
        "原始剧本：" if not is_digest else "原始剧本的来源摘要：",
        "<script>" + source_context + "</script>",
    ]
    if is_digest:
        parts.append("chunk_summaries是全文检索摘要；head_anchor/tail_anchor是原文锚点；"
                     "source_ref/char_start/char_end用于回指来源。分块边界不是叙事边界，摘要未覆盖不代表原文缺失。")

    context = {name: value for name, value in entities.items()
               if name not in ("scope", "selected_creative_methods", "series_director_understanding") and value}
    series_profile = entities.get("series_director_understanding")
    if series_profile:
        context["series_director_understanding"] = director_execution_payload(series_profile)
    if context:
        parts.append("已提取实体名称与关系不得擅自替换：\n<entities>" + _prompt_json(context) + "</entities>")
    if context.get("series_context") or series_profile:
        parts.append("系列上下文仅作背景和连续性约束，不代表本集已发生的事实；不得把全剧事件复制为本集事件。")

    if key in ("foundation", "continuity"):
        if style:
            parts.append("用户视觉风格（只约束视听表达，不改变故事事实）：\n<visual_style>"
                         + _prompt_json(style) + "</visual_style>")
        else:
            parts.append("未指定视觉媒介；不要自行假设真人、动漫或3D。")
    methods = [task for task in entities.get("selected_creative_methods", []) if key in METHOD_STEPS[task["id"]]]
    if methods:
        parts.append(guidance(methods) + "只将本步适用的发现写入本步字段，其余由对应步骤处理。")
        if key != "foundation" and any("unresolved_questions" in task["instructions"] for task in methods):
            destination = "key_events条目的review_notes" if key == "story" else "canon_state.uncertainties"
            parts.append("所选方法提到的unresolved_questions在本步记录到" + destination + "；不得新增顶层字段。")
    parts.extend((GUIDANCE[key],
                  "本次JSON总长度控制在18000字符内；不展开镜头和对白。",
                  _director_profile_output_contract(fields=fields)))
    if profile:
        # Do not resend the source, raw responses, server metadata or empty
        # containers. Story needs the foundation summary, continuity the map too.
        handoff = {name: value for name, value in director_execution_payload(profile).items()
                   if name in ("execution_summary", "story_map") and value}
        if handoff:
            parts.append("前序结果只读，不重新生成：\n<completed_steps_readonly>"
                         + _prompt_json(handoff) + "</completed_steps_readonly>")
    return "\n".join(parts)


def analyze_in_stages(processor, text, entities, style, *, source_mode="auto",
                      cached=None, save_step=None, validate_profile):
    """Save only validated steps; a rejected write stops further model calls."""
    from .llm import (_strip_markdown_json,
                      DIRECTOR_PROFILE_TIMEOUT_SECONDS, DIRECTOR_PROFILE_MAX_RETRIES)

    for task in entities.get("selected_creative_methods", []):
        if task["id"] not in METHOD_STEPS:
            raise ValueError("创作方法尚未分配导演分析步骤：" + task["id"])
    identity = hashlib.sha256(json.dumps(
        [VERSION, text, entities, style, source_mode, processor.llm.provider,
         processor.llm._get_default_model()], ensure_ascii=False, sort_keys=True, default=str
    ).encode()).hexdigest()
    processor._last_director_raw_response = ""
    processor._last_director_source_audit = {}
    profile, audit = {}, {"generation_mode": VERSION, "steps": [], "raw_response": ""}
    source_context, is_digest = "", False
    current, category = "source", "source"
    try:
        for index, (key, label, fields) in enumerate(STAGES):
            current, category = key, "validation"
            audit["raw_response"] = ""
            audit.pop("raw_response_sha256", None)
            entry = (cached or {}).get(index, {})
            saved = entry.get("frames", {})
            reused = (entry.get("source_ref") == key and isinstance(saved, dict)
                      and saved.get("identity") == identity and saved.get("stage") == key)
            if key == "source":
                if reused:
                    source_context = saved["source_context"]
                    is_digest = saved["is_digest"]
                    if not isinstance(source_context, str) or not source_context.strip() or not isinstance(is_digest, bool):
                        raise ValueError("来源整理缓存无效，请重新分析。")
                    audit.update(saved["source_audit"])
                else:
                    processor._last_director_source_audit = {}
                    source_audit = processor.director_source_audit(text, source_mode)
                    source_context, is_digest = processor._director_source_context(text, source_mode)
                    audit.update(source_audit)
                    saved = {"identity": identity, "stage": key, "source_context": source_context,
                             "is_digest": is_digest, "source_audit": source_audit}
                if not reused and save_step:
                    category = "checkpoint"
                    if save_step(index, key, saved) is False:
                        raise RuntimeError("导演分析任务已失效，请重新提交。")
                # Reuse the same source digest on restart; no paid map pass repeats.
                continue

            if reused:
                patch = saved["profile"]
                raw = saved.get("raw_response", "")
            else:
                # A later step sees a compact, validated handoff, never prior raw
                # responses or a second copy of the full screenplay/schema.
                prompt = build_step_prompt(key, source_context, is_digest, entities, style, profile)
                category = "provider"
                raw = (processor.llm.chat(
                    messages=[{"role": "system", "content": prompt},
                              {"role": "user", "content": "只生成“" + label + "”步骤的数据。"}],
                    response_format={"type": "json_object"}, stream=True,
                    timeout_seconds=DIRECTOR_PROFILE_TIMEOUT_SECONDS,
                    max_retries=DIRECTOR_PROFILE_MAX_RETRIES,
                ) or "").strip()
                category = "parse"
                audit["raw_response"] = raw[:MAX_RESPONSE_CHARS]
                if not raw or len(raw) > MAX_RESPONSE_CHARS:
                    raise ValueError("本步骤输出为空或超过预算，请重试。")
                patch = json.loads(_strip_markdown_json(raw))
            category = "validation"
            if not isinstance(patch, dict) or set(patch) != set(fields):
                raise ValueError("本步骤返回字段缺失或包含其他步骤内容，请重试。")
            if key == "story":
                story = patch.get("story_map")
                if (not isinstance(story, dict) or story.get("schema_version") != 1
                        or any(not isinstance(story.get(name), list)
                               for name in ("phases", "relationship_arcs", "story_threads"))):
                    raise ValueError("故事结构步骤缺少规范的 story_map 对象，请重试。")
            if key == "continuity":
                has_events = any(phase["events"] for phase in profile.get("story_map", {}).get("phases", []))
                if has_events and not patch.get("scene_summaries"):
                    raise ValueError("场景连续性缺少原文场景记录，请重试。")
            candidate = validate_profile({**profile, **patch})
            if key == "story":
                story = candidate["story_map"]
                if (len(story["phases"]) > 8 or sum(len(p["events"]) for p in story["phases"]) > 16
                        or len(story["relationship_arcs"]) > 8 or len(story["story_threads"]) > 4):
                    raise ValueError("故事结构超过单步输出预算，请重新生成精简结构。")
            if key == "continuity":
                if len(candidate["scene_summaries"]) > 16:
                    raise ValueError("场景连续性超过单步输出预算，请重试。")
            # Persist normalized, admitted fields only. No server-bound data
            # from another source/owner is ever accepted from cached responses.
            normalized_patch = {name: candidate[name] for name in fields}
            if not reused:
                saved = {"identity": identity, "stage": key, "profile": normalized_patch, "raw_response": raw}
                if save_step:
                    category = "checkpoint"
                    if save_step(index, key, saved) is False:
                        raise RuntimeError("导演分析任务已失效，请重新提交。")
            audit["raw_response"] = raw
            audit["raw_response_sha256"] = hashlib.sha256(raw.encode()).hexdigest()
            profile.update(normalized_patch)
            audit["steps"].append({"stage": key, "status": "completed", "reused": bool(reused),
                                   "raw_response": raw, "raw_response_sha256": hashlib.sha256(raw.encode()).hexdigest()})
        audit.update(parse_status="parsed", normalization_status="normalized", admission_status="confirmable",
                     raw_response_received=True)
        return {"profile": profile, "source_audit": audit}
    except Exception as exc:
        audit["failure_stage"] = current
        audit["failure_category"] = category
        audit["raw_response_received"] = bool(audit.get("raw_response"))
        audit["admission_status"] = "blocked"
        diagnostic = getattr(exc, "llm_diagnostic", None)
        if isinstance(diagnostic, dict):
            audit["provider_response"] = diagnostic
        exc.director_audit = audit
        exc.director_profile_failure = current
        exc.director_profile_failure_category = category
        raise
