"""Source-covered structure planning and durable, bounded shot expansion."""
import copy
import hashlib
import json
import logging
import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from src.apps.director_skills import guidance as director_skill_guidance
from ...utils.llm_json import parse_model_json_object

VERSION = 'scene-beat-boundaries-v6'
logger = logging.getLogger(__name__)
SOURCE_UNIT_CHARS = 240
MAX_BEAT_CHARS = 480
MAX_BEAT_SHOTS = 3
MAX_REPAIR_CHARS = 16000
Text = Annotated[str, Field(max_length=240)]
Detail = Annotated[str, Field(max_length=240)]


class StructureBeat(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    title: Annotated[str, Field(max_length=180)]
    dramatic_purpose: Detail
    emotional_change: Text
    source_end: int = Field(ge=1)
    story_event_ids: list[Text] = Field(default_factory=list, max_length=20)
    keep_with_next: bool = False

    @model_validator(mode='after')
    def unique_events(self):
        if len(self.story_event_ids) != len(set(self.story_event_ids)):
            raise ValueError('Duplicate story_event_ids')
        return self


class StructureScene(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    scene_ref: Text = ''
    heading: Text = ''
    location: Text = ''
    time_anchor: Annotated[str, Field(max_length=160)] = ''
    place_continuity_id: Annotated[str, Field(max_length=120)] = ''
    time_continuity_id: Annotated[str, Field(max_length=120)] = ''
    environment_atmosphere: Detail = ''
    continuity_in: Detail = ''
    continuity_out: Detail = ''
    continues_previous_scene: bool = False
    prop_ids: list[Text] = Field(default_factory=list, max_length=40)
    unresolved_questions: list[Text] = Field(default_factory=list, max_length=10)
    beats: list[StructureBeat] = Field(min_length=1, max_length=40)

    @model_validator(mode='after')
    def unique_props(self):
        if len(self.prop_ids) != len(set(self.prop_ids)):
            raise ValueError('Duplicate prop_ids')
        return self


class Structure(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    scenes: list[StructureScene] = Field(min_length=1, max_length=40)
    unresolved_questions: list[Text] = Field(default_factory=list, max_length=20)


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True)


def _one_character_typo(left, right):
    if left == right or abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        return sum(a != b for a, b in zip(left, right)) == 1
    shorter, longer = sorted((left, right), key=len)
    return any(longer[:i] + longer[i + 1:] == shorter for i in range(len(longer)))


def normalize_structure_containers(value):
    """Correct only unique structural array spelling, never semantic fields.

    Values are unchanged, and the complete normal schema/boundary validation
    remains mandatory. Conflicting/ambiguous keys and malformed rows survive
    unchanged so that validation rejects them instead of dropping evidence.
    """
    result = copy.deepcopy(value)
    corrections = []

    def container(obj, canonical, model, path):
        if not isinstance(obj, dict) or canonical in obj:
            return
        candidates = [key for key in obj if key not in model.model_fields
                      and _one_character_typo(key, canonical)]
        if len(candidates) != 1:
            return
        key = candidates[0]
        rows = obj[key]
        if not isinstance(rows, list) or not rows or any(not isinstance(row, dict) for row in rows):
            return
        obj[canonical] = obj.pop(key)
        corrections.append({'path': path, 'from': key, 'to': canonical})

    container(result, 'scenes', Structure, '$')
    scenes = result.get('scenes') if isinstance(result, dict) else None
    if isinstance(scenes, list):
        for index, scene in enumerate(scenes):
            container(scene, 'beats', StructureScene, f'scenes.{index}')
    return result, corrections


def split_shooting_source(text):
    """Keep natural source boundaries instead of coalescing several beat lines."""
    positions = {0, len(text)}
    for match in re.finditer(r'\r\n|\r|\n|[。！？!?；;]["”’\'』」）】》]*', text):
        positions.add(match.end())
    units = []
    boundaries = sorted(positions)
    for start, end in zip(boundaries, boundaries[1:]):
        # Attach blank lines to preceding evidence when the size budget fits.
        if not text[start:end].strip():
            if units and len(units[-1]['text']) + end - start <= SOURCE_UNIT_CHARS:
                units[-1]['text'] += text[start:end]
                units[-1]['char_end'] = end
                continue
        for offset in range(start, end, SOURCE_UNIT_CHARS):
            stop = min(end, offset + SOURCE_UNIT_CHARS)
            units.append({'text': text[offset:stop], 'char_start': offset, 'char_end': stop})
    return units


def _source_assignments(value):
    """Inspect boundaries independently of unrelated field validation."""
    if not isinstance(value, dict) or not isinstance(value.get('scenes'), list):
        return None
    assignments = []
    for si, scene in enumerate(value['scenes']):
        if not isinstance(scene, dict) or not isinstance(scene.get('beats'), list):
            return None
        for bi, beat in enumerate(scene['beats']):
            end = beat.get('source_end') if isinstance(beat, dict) else None
            if type(end) is not int:
                return None
            assignments.append({'scene': si + 1, 'beat': bi + 1, 'source_end': end})
    return assignments


def _boundary_error(assignments, units):
    if assignments is None:
        return ''
    start = 0
    problems = []
    for beat in assignments:
        end = beat['source_end']
        prefix = f"场景{beat['scene']}节拍{beat['beat']}"
        if not start < end <= len(units):
            problems.append(prefix + f': source_end={end}须大于前一边界{start}且不超过{len(units)}')
        elif sum(len(unit['text']) for unit in units[start:end]) > MAX_BEAT_CHARS:
            problems.append(prefix + f': 来源超过{MAX_BEAT_CHARS}字符，须增加节拍边界')
        start = end
    if start != len(units):
        problems.append(f'末尾未完整覆盖：最后source_end={start}，必须为{len(units)}')
    return '；'.join(problems[:6])


def _event_catalog(profile):
    """Use only IDs from the exact read-only map supplied for this request."""
    result = {}
    story = profile.get('story_map') or {}
    for phase in story.get('phases', []):
        for event in phase.get('events', []):
            event_id = event.get('event_id')
            if isinstance(event_id, str) and event_id:
                result[event_id] = {'event_id': event_id, 'title': str(event.get('title') or '')[:100]}
    return list(result.values())


def _invalid_event_refs(value, profile):
    allowed = {event['event_id'] for event in _event_catalog(profile)}
    scenes = value.get('scenes') if isinstance(value, dict) else None
    if not isinstance(scenes, list):
        return []
    invalid = []
    for si, scene in enumerate(scenes):
        beats = scene.get('beats') if isinstance(scene, dict) else None
        if not isinstance(beats, list):
            continue
        for bi, beat in enumerate(beats):
            refs = beat.get('story_event_ids') if isinstance(beat, dict) else None
            for ri, ref in enumerate(refs if isinstance(refs, list) else []):
                if isinstance(ref, str) and ref not in allowed:
                    invalid.append({'path': f'scenes.{si}.beats.{bi}.story_event_ids.{ri}', 'value': ref})
            shots = beat.get('shots') if isinstance(beat, dict) else None
            for shi, shot in enumerate(shots if isinstance(shots, list) else []):
                info = shot.get('information_design') if isinstance(shot, dict) else None
                if not isinstance(info, dict):
                    continue
                for field in ('source_event_ids', 'reveal_event_ids', 'payoff_event_ids'):
                    refs = info.get(field)
                    for ri, ref in enumerate(refs if isinstance(refs, list) else []):
                        if isinstance(ref, str) and ref not in allowed:
                            invalid.append({'path': f'scenes.{si}.beats.{bi}.shots.{shi}.information_design.{field}.{ri}', 'value': ref})
    return invalid


def _reference_error(invalid):
    if not invalid:
        return ''
    # Values are included only in the private provider repair context below.
    label = 'information_design' if any('.information_design.' in item['path'] for item in invalid) else 'story_event_ids'
    return (label + ' 含未确认事件引用：' + '、'.join(item['path'] for item in invalid[:6])
            + f'（共{len(invalid)}项）；只能选择allowed_story_events中的event_id，无关联时返回[]')


def shooting_event_reference_error(value, profile):
    """Check beat and shot references before admitting or reusing paid output."""
    return _reference_error(_invalid_event_refs(value, profile))


def _structure(value, units, profile):
    structure = Structure.model_validate(value)
    # A display label is not screenplay evidence. Reuse only an existing
    # source label/location; do not reject valid beats or invent a scene name.
    for scene in structure.scenes:
        if not scene.heading.strip():
            scene.heading = scene.scene_ref.strip() or scene.location.strip()
    boundary_error = _boundary_error(_source_assignments(structure.model_dump()), units)
    if boundary_error:
        raise ValueError('source_end 覆盖无效：' + boundary_error)
    reference_error = _reference_error(_invalid_event_refs(structure.model_dump(), profile))
    if reference_error:
        raise ValueError(reference_error)
    result = structure.model_dump()
    start = 0
    for scene in result['scenes']:
        for beat in scene['beats']:
            end = beat.pop('source_end')
            beat['source_unit_ids'] = list(range(start, end))
            start = end
    return result


def _boundary_payload(structure):
    """Revalidate saved internal ranges against the same model contract."""
    result = copy.deepcopy(structure)
    start = 0
    for scene in result['scenes']:
        for beat in scene['beats']:
            ids = beat.pop('source_unit_ids')
            if (not isinstance(ids, list) or not ids or any(type(i) is not int for i in ids)
                    or ids != list(range(start, ids[-1] + 1))):
                raise ValueError('已保存来源范围不连续，请重新生成。')
            start = ids[-1] + 1
            beat['source_end'] = start
    return result


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
                      DIRECTOR_PROFILE_MAX_RETRIES)
    from .shooting_shot_contract import output_issues
    if not processor.is_configured:
        raise ValueError('LLM API Key 未配置。请在 API 配置中设置对应的 API Key 后重试。')
    units = split_shooting_source(text)
    if not text.strip():
        raise ValueError('拍摄计划需要非空剧本。')
    structure_schema = Structure.model_json_schema()
    structure_schema['$defs']['StructureBeat']['properties']['source_end']['maximum'] = len(units)
    structure_schema['properties']['scenes']['maxItems'] = min(40, len(units))
    structure_schema['$defs']['StructureScene']['properties']['beats']['maxItems'] = min(40, len(units))
    allowed_events = _event_catalog(profile)
    refs_schema = structure_schema['$defs']['StructureBeat']['properties']['story_event_ids']
    if allowed_events:
        refs_schema['items']['enum'] = [event['event_id'] for event in allowed_events]
    else:
        refs_schema['maxItems'] = 0
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
每个节拍只填写source_end，表示本节拍覆盖到的结束边界（不含该边界后的单元），后续生成1–{MAX_BEAT_SHOTS}个镜头。
必须覆盖所有输入单元，不能重复、跳过、重排或扩写剧情；若一场较长，拆成多个节拍，不要新增场景。
首个节拍从边界0开始，后续节拍从上一个source_end开始；跨场景也不重置。
所有source_end必须严格递增，最后一个必须为{len(units)}；不要输出source_unit_ids或重复列举单元编号。
source_end是结束位置，不是长度；本节拍来源=上个边界至本边界之间的全部单元。每节拍来源最多{MAX_BEAT_CHARS}字符。
全部场景合计最多{len(units)}个节拍，不能按每个动作/对白另建节拍并重复引用单元。
节拍字段dramatic_purpose是戏剧目的，必须使用此精确键名，不要改写或另造字段名。
边界落在同一连续动作时 keep_with_next=true。只有原文明确承接上一段时首场可设 continues_previous_scene=true。
标题简短，目的、情绪、氛围、进出状态各用一句话，尽量不超过60字，不复述原文；story_event_ids 仅用已确认事件，无关联用 []。地点、时段连续性不按同名推断。
story_event_ids只能从allowed_story_events逐字复制event_id，不得用标题、phase_id、人物ID或自行编号；关联不确定或列表为空时用[]。
<allowed_story_events>{_json(allowed_events)}</allowed_story_events>
场景标题 heading 是显示标签：有依据时填写；无法确定可省略，不要为补标题发明场景。
只返回符合下方 JSON Schema 的完整 JSON，不要解释，不要返回 shots。
根对象使用scenes数组，每个场景对象使用beats数组；数组元素必须是对象，不混入说明文字。
<structure_schema>{_json(structure_schema)}</structure_schema>
<source_units>{_json([{'start': i, 'end': i+1, 'text': unit['text']} for i, unit in enumerate(units)])}</source_units>
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
                key_corrections = []
                try:
                    parsed = parse_model_json_object(content or '')
                    parsed, key_corrections = normalize_structure_containers(parsed)
                    value = _structure(parsed, units, profile)
                except (ValueError, ValidationError) as exc:
                    boundary_error = ''
                    invalid_refs = _invalid_event_refs(parsed, profile)
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
                        boundary_error = _boundary_error(assignments, units)
                        if boundary_error:
                            reason += '；source_end 覆盖无效：' + boundary_error
                    elif isinstance(exc, json.JSONDecodeError):
                        reason = '场景与节拍规划不是完整 JSON'
                    else:
                        reason = '场景与节拍规划无效' if not str(exc).startswith(('source_end', 'story_event_ids')) else str(exc)
                    if invalid_refs and not reason.startswith('story_event_ids'):
                        reason += '；' + _reference_error(invalid_refs)
                    logger.warning('Shooting plan structure rejected: run=%s attempt=%s response_chars=%s error_type=%s issues=%s',
                                   identity[:12], attempt + 1, len(content or ''), type(exc).__name__,
                                   reason[:600])
                    if attempt:
                        raise DirectorShootingChunkError('structure_contract', reason) from exc
                    retry_note = '仅修正当前场景与节拍规划：' + reason
                    if invalid_refs:
                        private_refs = [{**item, 'value': item['value'][:240]} for item in invalid_refs[:12]]
                        retry_note += '\n以下是未通过引用，须由你核对事件目录后修正，不由服务端猜测替换：\n<invalid_story_event_refs>' + _json(private_refs) + '</invalid_story_event_refs>'
                    # Preserve actual faulty values for correction, without
                    # sending a second unbounded screenplay/response payload.
                    rejected_content = content if isinstance(parsed, dict) and len(content or '') <= MAX_REPAIR_CHARS else ''
                else:
                    state = {'version': VERSION, 'input_hash': identity, 'structure': value, 'details': {},
                             'structure_key_corrections': key_corrections}
                    if key_corrections:
                        logger.info('Shooting plan structural spelling normalized: run=%s corrections=%s',
                                    identity[:12], _json(key_corrections))
                    persist()
                    break
        structure = _structure(_boundary_payload(state['structure']), units, profile)
        result = copy.deepcopy(structure)
        handoff = previous_scene
        for si, scene in enumerate(result['scenes']):
            for bi, beat in enumerate(scene['beats']):
                stage = {'stage': 'shots', 'scene': si + 1, 'beat': bi + 1}
                key = f'{si}:{bi}'
                detail = state['details'].get(key)
                if detail is not None and output_issues(detail, profile, beat_only=True):
                    # Reopen only the detail failing the same admission contract
                    # used for new generation; never rewrite its fields locally.
                    del state['details'][key]
                    persist()
                    detail = None
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
                reference_error = shooting_event_reference_error({'scenes': [{'beats': [beat]}]}, profile)
                if reference_error:
                    raise DirectorShootingChunkError('event_reference', reference_error)
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
