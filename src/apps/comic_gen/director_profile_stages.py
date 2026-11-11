"""Checkpointed Director understanding; intermediate steps never become user drafts."""
import copy
import hashlib
import json
import re

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


class DirectorStepFieldsError(ValueError):
    """Public diagnostics use server-owned field names, never model prose."""

    def __init__(self, fields, value, *, completion=False, prefix=""):
        missing = [name for name in fields if not isinstance(value, dict) or name not in value]
        extra = isinstance(value, dict) and bool(set(value) - set(fields))
        detail = ""
        if missing:
            detail = ("补全结果" if completion else "模型结果") + "缺少必填字段：" + "、".join(prefix + name for name in missing)
        if extra or not isinstance(value, dict):
            detail = (detail + "；" if detail else "") + "返回了本步骤之外的字段或非对象结构"
        self.public_reason = detail
        super().__init__(detail)


STORY_MAP_FIELDS = ("schema_version", "phases", "relationship_arcs", "story_threads")


def _missing_story_map_fields(value):
    if not isinstance(value, dict):
        raise ValueError("故事结构步骤的 story_map 必须为对象")
    if "schema_version" in value and value["schema_version"] != 1:
        raise ValueError("story_map.schema_version 必须为 1")
    for name in STORY_MAP_FIELDS[1:]:
        if name in value and not isinstance(value[name], list):
            raise ValueError("story_map." + name + " 必须为数组")
    return tuple(name for name in STORY_MAP_FIELDS if name not in value)


def _require_story_map(value):
    if _missing_story_map_fields(value):
        raise DirectorStepFieldsError(STORY_MAP_FIELDS, value, prefix="story_map.")


def _displaced_story_arrays(value):
    """Recognize container drift, never interpret prose as a new story phase.

    Some valid JSON responses append field labels and nested arc/thread arrays
    to phases. Collect the existing objects for preflight validation and for
    enforcing a lossless, single model correction. This projection is never
    saved as a Director result by itself.
    """
    phases = value.get("phases", [])
    if not any(not isinstance(item, dict) for item in phases):
        return None
    groups = {"phases": [], "relationship_arcs": [], "story_threads": []}

    def collect(items, *, root=False):
        for item in items:
            if isinstance(item, dict):
                kinds = [name for name, identifier in (
                    ("phases", "phase_id"), ("relationship_arcs", "relationship_id"),
                    ("story_threads", "thread_id")) if identifier in item]
                if len(kinds) != 1 or (kinds[0] == "phases") != root:
                    raise ValueError("故事结构存在无法安全修正的错位条目")
                groups[kinds[0]].append(item)
            elif isinstance(item, list):
                collect(item)
            elif not isinstance(item, str) or not re.fullmatch(r"[a-z_]{1,40}", item):
                # Narrative text, numbers and unknown object shapes must not
                # be discarded or converted into server-invented events.
                raise ValueError("故事阶段包含非结构性条目，请重新生成")

    collect(phases, root=True)
    moved = [name for name in ("relationship_arcs", "story_threads") if groups[name]]
    if not moved or any(name in value for name in moved):
        raise ValueError("故事结构错位字段不明确，请重新生成")
    return {"phases": groups["phases"], **{name: groups[name] for name in moved}}


def build_step_prompt(key, source_context, is_digest, entities, style, profile, *, output_fields=None, completed_fields=None, story_map_fields=None, displaced_arrays=None):
    """Build a scoped request without full-profile/extraction preset baggage."""
    from src.apps.director_skills import guidance
    from .llm import _director_profile_output_contract, _prompt_json
    from .models import director_execution_payload

    _, label, fields = next(stage for stage in STAGES[1:] if stage[0] == key)
    if output_fields is not None and (not output_fields or not set(output_fields).issubset(fields)):
        raise ValueError("补全字段不属于当前步骤")
    fields = fields if output_fields is None else output_fields
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
    step_guidance = GUIDANCE[key]
    if completed_fields is not None:
        # Replace the full-step field list rather than contradicting the
        # missing-fields-only contract later in this request.
        step_guidance = step_guidance.split("。", 1)[1]
    parts.extend((step_guidance,
                  "本次JSON总长度控制在18000字符内；不展开镜头和对白。",
                  _director_profile_output_contract(fields=fields, story_map_fields=story_map_fields)))
    if completed_fields is not None:
        parts.append("这是本步骤缺字段或容器错位的唯一一次补全。已有合法对象只读，保留其含义和引用；"
                     "不要把 timeline 复制当作 story_map，不重写已有字段或其他步骤。\n"
                     "<completed_fields_readonly>" + _prompt_json(completed_fields) + "</completed_fields_readonly>")
    if story_map_fields:
        parts.append("story_map 本次只补全：" + "、".join("story_map." + name for name in story_map_fields)
                     + "。已有合法阶段、事件和其他字段只读；新引用必须对应已有阶段和事件ID。")
    if displaced_arrays:
        parts.append("原结果把关系线/故事线数组和字段名误放入phases。本次只纠正容器位置："
                     "phases只保留原有阶段对象，顺序不变；将错位的关系线和故事线对象放回对应数组。"
                     "所有已有对象必须逐项原样保留，不增删阶段、事件或ID；结构字段名不是剧情。\n"
                     "<displaced_objects_readonly>" + _prompt_json(displaced_arrays) + "</displaced_objects_readonly>")
    parts.append("本次只输出以下顶层字段：" + "、".join(fields) + "。每个字段都必须存在；空数组也不得省略。")
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
            audit.pop("field_completion", None)
            audit.pop("field_contract", None)
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
            completion = saved.get("field_completion") if reused else None
            # Only a nonempty subset with valid existing fields can be
            # completed. Never synthesize a story map, retry malformed JSON,
            # erase unknown keys, or rewrite fields already returned.
            nested_missing = ()
            displaced_arrays = None
            if key == "story" and isinstance(patch, dict) and "story_map" in patch:
                nested_missing = _missing_story_map_fields(patch["story_map"])
                displaced_arrays = _displaced_story_arrays(patch["story_map"])
                if displaced_arrays:
                    nested_missing = tuple(name for name in STORY_MAP_FIELDS
                                           if name in nested_missing or name in displaced_arrays)
            if (key == "story" and not reused and isinstance(patch, dict) and patch
                    and set(patch).issubset(fields) and (set(patch) < set(fields) or nested_missing)):
                preflight = copy.deepcopy({**profile, **patch})
                if displaced_arrays:
                    preflight["story_map"].update(copy.deepcopy(displaced_arrays))
                validate_profile(preflight)
                missing = tuple(name for name in fields if name not in patch or name == "story_map" and nested_missing)
                paths = [name for name in missing if name != "story_map" or not nested_missing]
                paths.extend("story_map." + name for name in nested_missing)
                completion = {"fields": list(missing), "paths": paths, "raw_response": ""}
                audit["field_completion"] = completion
                prompt = build_step_prompt(key, source_context, is_digest, entities, style, profile,
                                           output_fields=missing, completed_fields=patch,
                                           story_map_fields=nested_missing or None,
                                           displaced_arrays=displaced_arrays)
                category = "provider"
                completion_raw = (processor.llm.chat(
                    messages=[{"role": "system", "content": prompt},
                              {"role": "user", "content": "只补全缺失字段：" + "、".join(missing)}],
                    response_format={"type": "json_object"}, stream=True,
                    timeout_seconds=DIRECTOR_PROFILE_TIMEOUT_SECONDS,
                    max_retries=DIRECTOR_PROFILE_MAX_RETRIES,
                ) or "").strip()
                completion["raw_response"] = completion_raw[:MAX_RESPONSE_CHARS]
                category = "parse"
                if not completion_raw or len(raw) + len(completion_raw) > MAX_RESPONSE_CHARS:
                    raise ValueError("补全输出为空或超过预算，请重试。")
                extra_patch = json.loads(_strip_markdown_json(completion_raw))
                category = "validation"
                if not isinstance(extra_patch, dict) or set(extra_patch) != set(missing):
                    raise DirectorStepFieldsError(missing, extra_patch, completion=True)
                if nested_missing:
                    nested_patch = extra_patch["story_map"]
                    if not isinstance(nested_patch, dict) or set(nested_patch) != set(nested_missing):
                        raise DirectorStepFieldsError(nested_missing, nested_patch, completion=True, prefix="story_map.")
                    if displaced_arrays and any(nested_patch[name] != objects for name, objects in displaced_arrays.items()):
                        raise ValueError("故事结构容器修正改变了已有对象，请重新生成")
                    extra_patch["story_map"] = {**patch["story_map"], **nested_patch}
                patch = {**patch, **extra_patch}
            if not isinstance(patch, dict) or set(patch) != set(fields):
                raise DirectorStepFieldsError(fields, patch)
            if key == "story":
                _require_story_map(patch.get("story_map"))
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
                if completion:
                    saved["field_completion"] = completion
                if save_step:
                    category = "checkpoint"
                    if save_step(index, key, saved) is False:
                        raise RuntimeError("导演分析任务已失效，请重新提交。")
            audit["raw_response"] = raw
            audit["raw_response_sha256"] = hashlib.sha256(raw.encode()).hexdigest()
            profile.update(normalized_patch)
            audit["steps"].append({"stage": key, "status": "completed", "reused": bool(reused),
                                   "raw_response": raw, "raw_response_sha256": hashlib.sha256(raw.encode()).hexdigest()})
            if completion:
                audit["steps"][-1]["field_completion"] = completion
        audit.update(parse_status="parsed", normalization_status="normalized", admission_status="confirmable",
                     raw_response_received=True)
        return {"profile": profile, "source_audit": audit}
    except Exception as exc:
        audit["failure_stage"] = current
        audit["failure_category"] = category
        audit["raw_response_received"] = bool(audit.get("raw_response"))
        audit["admission_status"] = "blocked"
        if isinstance(exc, DirectorStepFieldsError):
            audit["field_contract"] = {"public_reason": exc.public_reason}
        diagnostic = getattr(exc, "llm_diagnostic", None)
        if isinstance(diagnostic, dict):
            audit["provider_response"] = diagnostic
        exc.director_audit = audit
        exc.director_profile_failure = current
        exc.director_profile_failure_category = category
        raise
