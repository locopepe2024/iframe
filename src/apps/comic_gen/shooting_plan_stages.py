"""Source-covered structure planning and durable, bounded shot expansion."""
import copy
import hashlib
import json
import logging
from collections import Counter
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from src.apps.director_skills import guidance as director_skill_guidance
from ...utils.llm_json import parse_model_json_object

VERSION = 'scene-beat-shots-v3'
logger = logging.getLogger(__name__)
SOURCE_UNIT_CHARS = 240
MAX_BEAT_UNITS = 2
MAX_BEAT_SHOTS = 3
MAX_REPAIR_CHARS = 16000
Text = Annotated[str, Field(max_length=240)]
Detail = Annotated[str, Field(max_length=240)]


class StructureBeat(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    title: Text
    dramatic_purpose: Detail
    emotional_change: Text
    source_unit_ids: list[int] = Field(min_length=1, max_length=MAX_BEAT_UNITS)
    story_event_ids: list[Text] = Field(default_factory=list, max_length=20)
    keep_with_next: bool = False


class StructureScene(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    scene_ref: Text = ''
    heading: Text = ''
    location: Text = ''
    time_anchor: Text = ''
    place_continuity_id: Text = ''
    time_continuity_id: Text = ''
    environment_atmosphere: Detail = ''
    continuity_in: Detail = ''
    continuity_out: Detail = ''
    continues_previous_scene: bool = False
    prop_ids: list[Text] = Field(default_factory=list, max_length=40)
    unresolved_questions: list[Text] = Field(default_factory=list, max_length=10)
    beats: list[StructureBeat] = Field(min_length=1, max_length=40)


class Structure(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    scenes: list[StructureScene] = Field(min_length=1, max_length=40)
    unresolved_questions: list[Text] = Field(default_factory=list, max_length=20)


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


def _source_assignments(value):
    """Inspect coverage independently of unrelated model-field validation."""
    if not isinstance(value, dict) or not isinstance(value.get('scenes'), list):
        return None
    assignments = []
    for si, scene in enumerate(value['scenes']):
        if not isinstance(scene, dict) or not isinstance(scene.get('beats'), list):
            return None
        for bi, beat in enumerate(scene['beats']):
            ids = beat.get('source_unit_ids') if isinstance(beat, dict) else None
            if not isinstance(ids, list) or any(type(i) is not int for i in ids):
                return None
            assignments.append({'scene': si + 1, 'beat': bi + 1, 'source_unit_ids': ids})
    return assignments


class SourceCoverageError(ValueError):
    """Numeric-only evidence for a bounded structure correction."""

    def __init__(self, assignments, unit_count):
        covered = [i for beat in assignments for i in beat['source_unit_ids']]
        counts = Counter(covered)
        missing = [i for i in range(unit_count) if i not in counts]
        duplicate = sorted(i for i, n in counts.items() if n > 1)
        outside = sorted(i for i in counts if not 0 <= i < unit_count)
        differences = []
        for name, ids in (('缺失编号', missing), ('重复编号', duplicate), ('越界编号', outside)):
            if ids:
                differences.append(name + '=' + _json(ids[:12]))
        if covered != sorted(covered):
            differences.append('顺序错误')
        super().__init__('source_unit_ids 覆盖无效：' + '；'.join(differences))
        self.retry_context = ('\n期望展平编号=' + _json(list(range(unit_count)))
                              + '\n上次各节拍分配（最多80项，总数=' + str(len(assignments)) + '）：'
                              + '\n<rejected_source_assignments>' + _json([
                                  {**beat, 'source_unit_ids': beat['source_unit_ids'][:MAX_BEAT_UNITS]}
                                  for beat in assignments[:80]])
                              + '</rejected_source_assignments>')


def _structure(value, units, profile):
    structure = Structure.model_validate(value)
    # A display label is not screenplay evidence. Reuse only an existing
    # source label/location; do not reject valid beats or invent a scene name.
    for scene in structure.scenes:
        if not scene.heading.strip():
            scene.heading = scene.scene_ref.strip() or scene.location.strip()
    covered = [i for scene in structure.scenes for beat in scene.beats for i in beat.source_unit_ids]
    if covered != list(range(len(units))):
        raise SourceCoverageError(_source_assignments(structure.model_dump()), len(units))
    event_ids = {event['event_id'] for phase in profile.get('story_map', {}).get('phases', [])
                 for event in phase.get('events', []) if event.get('event_id')}
    if any(event not in event_ids for scene in structure.scenes for beat in scene.beats
           for event in beat.story_event_ids):
        raise ValueError('story_event_ids 只能引用已确认故事结构中的事件')
    return structure.model_dump()


def _scoped_profile(profile, scene, beat):
    """Keep global constraints, current scene evidence, and current event IDs."""
    result = {key: profile[key] for key in ('revision', 'content_hash', 'execution_summary', 'canon_state')
              if key in profile}
    summaries = profile.get('scene_summaries', [])
    result['scene_summaries'] = [item for item in summaries if (
        (scene.get('scene_ref') and item.get('scene_ref') == scene['scene_ref'])
        or (scene.get('location') and item.get('location') == scene['location']))]
    if not result['scene_summaries'] and len(summaries) <= 3:
        result['scene_summaries'] = summaries
    phases = []
    for phase in profile.get('story_map', {}).get('phases', []):
        events = [event for event in phase.get('events', []) if event.get('event_id') in beat['story_event_ids']]
        if events:
            phases.append({**{k: v for k, v in phase.items() if k != 'events'}, 'events': events})
    result['story_map'] = {'phases': phases}
    return result


def _handoff(scene, beat, detail):
    """Do not feed accumulated shot JSON back into the next request."""
    return {**{k: scene.get(k, '') for k in (
        'scene_ref', 'heading', 'location', 'time_anchor', 'place_continuity_id',
        'time_continuity_id')},
        'last_beat': beat['title'],
        'continuity_out': detail.get('continuity_out', '')[:600],
        'last_action': detail['shots'][-1].get('action_physics', '')[:500],
        'lighting': detail['shots'][-1].get('lighting', {})}


def plan_in_stages(processor, text, entities, profile, style, previous_scene=None, *,
                   source_ref='', model=None, checkpoint=None, save_checkpoint=None):
    from .llm import (DirectorShootingChunkError, DIRECTOR_SHOOTING_PLAN_TIMEOUT_SECONDS,
                      DIRECTOR_PROFILE_MAX_RETRIES, split_director_source)
    if not processor.is_configured:
        raise ValueError('LLM API Key 未配置。请在 API 配置中设置对应的 API Key 后重试。')
    units = split_director_source(text, direct_max_chars=SOURCE_UNIT_CHARS,
                                  target_chars=SOURCE_UNIT_CHARS, max_chars=SOURCE_UNIT_CHARS)
    expected_ids = list(range(len(units)))
    structure_schema = Structure.model_json_schema()
    structure_schema['$defs']['StructureBeat']['properties']['source_unit_ids']['items']['enum'] = expected_ids
    structure_schema['properties']['scenes']['maxItems'] = min(40, len(units))
    structure_schema['$defs']['StructureScene']['properties']['beats']['maxItems'] = min(40, len(units))
    identity = hashlib.sha256(_json([VERSION, text, entities, profile, style, previous_scene,
                                    source_ref, model]).encode()).hexdigest()
    state = copy.deepcopy(checkpoint) if isinstance(checkpoint, dict) else {}
    stage = {'stage': 'structure'}

    def persist():
        state['total_steps'] = 1 + sum(len(scene['beats']) for scene in state['structure']['scenes'])
        state['completed_steps'] = 1 + len(state['details'])
        if save_checkpoint and not save_checkpoint(copy.deepcopy(state)):
            raise RuntimeError('拍摄计划任务已过期，请重试。')

    try:
        if state.get('version') != VERSION or state.get('input_hash') != identity:
            logger.info('Shooting plan structure: run=%s source_chars=%s units=%s',
                        identity[:12], len(text), len(units))
            retry_note = ''
            rejected_content = ''
            for attempt in range(2):
                prompt = f'''你是导演。当前只规划场景和戏剧节拍，不生成镜头、摄影、光影字段。
输入单元按原文切分，不等于场景或节拍边界。先识别场景，再按原文顺序组织节拍；
每个节拍引用 1–{MAX_BEAT_UNITS} 个连续 source_unit_ids，后续将为该节拍生成 1–{MAX_BEAT_SHOTS} 个镜头。
必须覆盖所有输入单元，不能重复、跳过、重排或扩写剧情；若一场较长，拆成多个节拍，不要新增场景。
编号从0开始，只能使用source_units中的id；期望展平编号={_json(expected_ids)}。
将所有scenes内的beats依次展开，再连接各source_unit_ids，必须恰好等于这个编号序列。
单元是来源分配块，不是动作编号或镜头编号；同一块内有多个动作仍只分配一次，由后续镜头展开。
全部场景合计最多{len(units)}个节拍，不能按每个动作/对白另建节拍并重复引用单元。
节拍字段dramatic_purpose是戏剧目的，必须使用此精确键名，不要改写或另造字段名。
边界落在同一连续动作时 keep_with_next=true。只有原文明确承接上一段时首场可设 continues_previous_scene=true。
标题简短，目的、情绪、氛围、进出状态各用一句话，尽量不超过60字，不复述原文；story_event_ids 仅用已确认事件，无关联用 []。地点、时段连续性不按同名推断。
场景标题 heading 是显示标签：有依据时填写；无法确定可省略，不要为补标题发明场景。
只返回符合下方 JSON Schema 的完整 JSON，不要解释，不要返回 shots。
<structure_schema>{_json(structure_schema)}</structure_schema>
<source_units>{_json([{'id': i, 'text': unit['text']} for i, unit in enumerate(units)])}</source_units>
<confirmed_director_profile>{_json(profile)}</confirmed_director_profile>
<entities>{_json({k: v for k, v in entities.items() if k != 'selected_creative_methods'})}</entities>
<previous_scene_handoff>{_json(previous_scene or {})}</previous_scene_handoff>
{director_skill_guidance(entities.get('selected_creative_methods', []))}
{retry_note}'''
                messages = [{'role': 'system', 'content': prompt}]
                if rejected_content:
                    messages.extend([{'role': 'assistant', 'content': rejected_content},
                                     {'role': 'user', 'content': '修正上条JSON中的契约错误和来源分配；保留有效内容，返回完整修正版，不输出修正说明。'}])
                else:
                    messages.append({'role': 'user', 'content': '仅规划场景与节拍，完整覆盖原文。'})
                content = processor.llm.chat(
                    messages=messages,
                    response_format={'type': 'json_object'}, stream=True,
                    timeout_seconds=DIRECTOR_SHOOTING_PLAN_TIMEOUT_SECONDS,
                    max_retries=DIRECTOR_PROFILE_MAX_RETRIES,
                    **({'model': model} if model else {}))
                parsed = None
                try:
                    parsed = parse_model_json_object(content or '')
                    value = _structure(parsed, units, profile)
                except (ValueError, ValidationError) as exc:
                    coverage_error = exc if isinstance(exc, SourceCoverageError) else None
                    if isinstance(exc, ValidationError):
                        reasons = []
                        for issue in exc.errors()[:6]:
                            path = '.'.join(str(p) for p in issue['loc'])
                            kind = '缺少必填字段' if issue['type'] == 'missing' else issue['type']
                            detail = path + ': ' + kind
                            if issue['loc'] == ('scenes',) and issue['type'] == 'too_short':
                                detail = '必须返回至少一个 scene'
                            reasons.append(detail)
                        reason = '；'.join(reasons)
                        assignments = _source_assignments(parsed)
                        if assignments is not None and [i for beat in assignments for i in beat['source_unit_ids']] != expected_ids:
                            coverage_error = SourceCoverageError(assignments, len(units))
                            reason += '；' + str(coverage_error)
                    elif isinstance(exc, json.JSONDecodeError):
                        reason = '场景与节拍规划不是完整 JSON'
                    else:
                        reason = '场景与节拍规划无效' if not str(exc).startswith(('source_unit_ids', 'story_event_ids')) else str(exc)
                    logger.warning('Shooting plan structure rejected: run=%s attempt=%s response_chars=%s error_type=%s issues=%s',
                                   identity[:12], attempt + 1, len(content or ''), type(exc).__name__,
                                   reason[:600])
                    if attempt:
                        raise DirectorShootingChunkError('structure_contract', reason) from exc
                    retry_note = '仅修正当前场景与节拍规划：' + reason
                    if coverage_error is not None:
                        retry_note += coverage_error.retry_context
                    # Preserve actual faulty values for correction, without
                    # sending a second unbounded screenplay/response payload.
                    rejected_content = content if isinstance(parsed, dict) and len(content or '') <= MAX_REPAIR_CHARS else ''
                else:
                    state = {'version': VERSION, 'input_hash': identity, 'structure': value, 'details': {}}
                    persist()
                    break
        structure = _structure(state['structure'], units, profile)
        result = copy.deepcopy(structure)
        handoff = previous_scene
        for si, scene in enumerate(result['scenes']):
            for bi, beat in enumerate(scene['beats']):
                stage = {'stage': 'shots', 'scene': si + 1, 'beat': bi + 1}
                key = f'{si}:{bi}'
                detail = state['details'].get(key)
                if detail is None:
                    source_text = ''.join(units[i]['text'] for i in beat['source_unit_ids'])
                    logger.info('Shooting plan shots: run=%s scene=%s beat=%s source_chars=%s',
                                identity[:12], si + 1, bi + 1, len(source_text))
                    beat_plan = {**{k: v for k, v in scene.items() if k != 'beats'}, 'beats': [beat]}
                    generated = processor._plan_director_shooting_beat(
                        source_text, entities, _scoped_profile(profile, scene, beat), style, handoff,
                        source_ref=source_ref, beat_plan=beat_plan, **({'model': model} if model else {}))
                    detail = {'shots': generated['scenes'][0]['beats'][0]['shots'],
                              'continuity_out': generated['scenes'][0].get('continuity_out', ''),
                              'unresolved_questions': generated.get('unresolved_questions', [])
                              + generated['scenes'][0].get('unresolved_questions', [])}
                beat.pop('source_unit_ids')
                beat['shots'] = detail['shots']
                error = processor._validate_director_shooting_chunk({'scenes': [{
                    **{k: v for k, v in scene.items() if k != 'beats'}, 'beats': [beat]}]})
                if error or not 1 <= len(beat['shots']) <= MAX_BEAT_SHOTS:
                    raise RuntimeError('拍摄计划已保存节拍不符合当前镜头契约，请重新生成。')
                if key not in state['details']:
                    state['details'][key] = detail
                    persist()
                result['unresolved_questions'].extend(detail['unresolved_questions'])
                handoff = _handoff(scene, beat, detail)
        return result
    except Exception as exc:
        exc.shooting_plan_failure = stage
        raise
