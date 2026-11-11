"""One generated-shot protocol for prompts, admission and durable resume.

Storage field definitions own types/limits. Generated output excludes server IDs
and editor-owned decisions; schema and runtime validation use this same model.
"""
import copy
import json
import logging
import re

from pydantic import BaseModel, ConfigDict, Field, ValidationError, create_model, model_validator

from .models import DirectorPlanShot, DirectorPlanBeat, DirectorPlanScene

MAX_BEAT_OUTPUT_CHARS = 6000
MAX_SHOT_REPAIR_CHARS = 8000


class GeneratedModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

    @model_validator(mode='after')
    def unique_references(self):
        for field in ('character_ids', 'prop_ids', 'story_event_ids', 'source_chunk_refs'):
            refs = getattr(self, field, [])
            if len(refs) != len(set(refs)):
                raise ValueError(field + ': duplicate IDs')
        return self


class ShotRules(GeneratedModel):
    @model_validator(mode='after')
    def check_references_and_dialogue(self):
        if any(not line.speaker.strip() or not line.line.strip() for line in self.dialogue):
            raise ValueError('dialogue: speaker and line must be nonempty')
        return self


def _fields(storage, excluded):
    return {key: (field.annotation, copy.deepcopy(field))
            for key, field in storage.model_fields.items() if key not in excluded}


GeneratedShootingShot = create_model(
    'GeneratedShootingShot', __base__=ShotRules,
    **_fields(DirectorPlanShot, {'shot_id', 'order', 'lighting_override_selected',
                               'cast_bindings', 'scene_binding', 'prop_bindings', 'crowd_instances'}))
GeneratedShootingBeat = create_model(
    'GeneratedShootingBeat', __base__=GeneratedModel,
    **{**_fields(DirectorPlanBeat, {'beat_id', 'order', 'shots'}),
       'shots': (list[GeneratedShootingShot], Field(min_length=1, max_length=40))})
GeneratedShootingScene = create_model(
    'GeneratedShootingScene', __base__=GeneratedModel,
    **{**_fields(DirectorPlanScene, {'scene_id', 'scene_asset_id', 'order', 'source_chunk_refs', 'beats'}),
       'place_continuity_id': (str, Field('', max_length=120)),
       'time_continuity_id': (str, Field('', max_length=120)),
       'beats': (list[GeneratedShootingBeat], Field(min_length=1, max_length=40))})


class ShootingChunk(GeneratedModel):
    scenes: list[GeneratedShootingScene] = Field(min_length=1, max_length=160)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=80)


class ShootingBeatOutput(GeneratedModel):
    shots: list[GeneratedShootingShot] = Field(min_length=1, max_length=3)
    continuity_out: str = Field('', max_length=600)
    unresolved_questions: list[str] = Field(default_factory=list, max_length=20)


def output_schema(profile, *, beat_only):
    from .shooting_plan_stages import _event_catalog
    schema = (ShootingBeatOutput if beat_only else ShootingChunk).model_json_schema()
    ids = [item['event_id'] for item in _event_catalog(profile)]
    info = schema['$defs']['DirectorInformationDesign']['properties']
    refs = [info[key] for key in ('source_event_ids', 'reveal_event_ids', 'payoff_event_ids')]
    if not beat_only:
        refs.append(schema['$defs']['GeneratedShootingBeat']['properties']['story_event_ids'])
    for field in refs:
        if ids:
            field['items']['enum'] = ids
        else:
            field['maxItems'] = 0
    # Required source linkage is also enforced by the persisted model validator.
    schema['$defs']['DirectorInformationDesign']['allOf'] = [{
        'if': {'properties': {'evidence_status': {'const': 'source_linked'}}, 'required': ['evidence_status']},
        'then': {'properties': {'source_event_ids': {'minItems': 1}}, 'required': ['source_event_ids']},
    }]
    for model in schema['$defs'].values():
        for field, definition in model.get('properties', {}).items():
            if field in ('character_ids', 'prop_ids', 'story_event_ids', 'source_chunk_refs'):
                definition['uniqueItems'] = True
    for field in ('speaker', 'line'):
        schema['$defs']['DirectorPlanDialogueLine']['properties'][field]['pattern'] = r'\S'
    return schema


def contract_issues(value, *, beat_only=False):
    """Bounded path/type diagnostics; never return model field values."""
    try:
        (ShootingBeatOutput if beat_only else ShootingChunk).model_validate(value, strict=True)
    except ValidationError as exc:
        issues = []
        for issue in exc.errors(include_input=False, include_context=False, include_url=False)[:12]:
            path = '.'.join(str(p) if isinstance(p, int) or re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]{0,59}', str(p))
                            else '<unknown_key>' for p in issue['loc']) or '$'
            kind = issue['type']
            label = {'extra_forbidden': '存在未知字段', 'missing': '缺少必填字段',
                     'model_type': '必须是 JSON 对象', 'string_type': '必须是字符串'}.get(kind, kind)
            if kind == 'extra_forbidden':
                parent, _, key = path.rpartition('.')
                operation = f'删除 {parent} 的额外键 {key}' if parent else f'删除根对象的额外键 {path}'
                label += '；' + operation
            if issue['loc'] == ('scenes',) and kind == 'too_short':
                label = '必须返回至少一个 scene'
            if kind == 'value_error':
                # Custom validators never expose the provider's actual values.
                label = '对象约束无效，请核对重复ID、对白非空与信息来源关联'
            issues.append(path + ': ' + label)
        return issues
    return []


def exclude_exact_style_echo(value, style):
    """Exclude only a verified duplicate of the read-only root input."""
    if (not isinstance(value, dict) or 'shots' not in value or 'visual_style' not in value
            or not isinstance(style, dict) or not isinstance(value['visual_style'], dict)):
        return value, []
    def encode(item):
        return json.dumps(item, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    if len(encode(value)) > MAX_BEAT_OUTPUT_CHARS or encode(value['visual_style']) != encode(style):
        return value, []
    result = copy.deepcopy(value)
    del result['visual_style']
    return result, [{'path': '$.visual_style', 'action': 'exclude_exact_input_echo',
                     'input': 'read_only_style_context'}]


def output_issues(value, profile, *, beat_only):
    from .shooting_plan_stages import shooting_event_reference_error
    issues = contract_issues(value, beat_only=beat_only)
    if beat_only and isinstance(value, dict):
        reference_value = {'scenes': [{'beats': [{'shots': value.get('shots')}]}]}
    else:
        reference_value = value
    refs = shooting_event_reference_error(reference_value, profile)
    if refs:
        issues.append(refs)
    if beat_only and len(json.dumps(value, ensure_ascii=False, separators=(',', ':'))) > MAX_BEAT_OUTPUT_CHARS:
        issues.append('当前节拍 JSON 超过6000字符，请精简重复描述并保留原文对白')
    return issues


def generate_shot_details(processor, text, entities, profile, style, previous_scene=None,
                          source_ref='', model=None, *, beat_plan=None):
    from src.apps.director_skills import guidance
    from .shooting_plan_stages import _event_catalog
    from .llm import (DirectorShootingChunkError, DIRECTOR_SHOOTING_PLAN_TIMEOUT_SECONDS,
                      DIRECTOR_PROFILE_MAX_RETRIES, _load_director_preset)
    from ...utils.llm_json import parse_model_json_object
    if not processor.is_configured:
        raise ValueError('LLM API Key 未配置。请在 API 配置中设置对应的 API Key 后重试。')
    def encode(value):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    beat_only = beat_plan is not None
    scope = ('当前只为已规划节拍生成1–3个镜头。场景和节拍是只读上下文，不重复输出它们。'
             if beat_only else '当前生成场景、节拍和镜头；按来源顺序组织，场景边界必须有原文依据。')
    # The broad preset is only applicable to a full-chunk proposal.
    preset = '' if beat_only else '<stage_preset name="shooting-plan-handoff">' + _load_director_preset('shooting-plan-handoff') + '</stage_preset>'
    root_instruction = ('根对象只能包含 shots、continuity_out、unresolved_questions。'
                        '根结构示例：{"shots":[{}],"continuity_out":"","unresolved_questions":[]}；镜头内容按Schema填写。'
                        if beat_only else '根对象只能包含 scenes、unresolved_questions。')
    root_instruction += ('visual_style、read_only_style_context、entities、confirmed_director_profile、current_beat_plan'
                         '都是只读输入，不得返回为输出字段；风格只体现在合法镜头描述里。')
    prompt = f'''你是电影导演和场记。{scope}
剧本片段是剧情事实来源；已确认导演理解是视觉约束；实体提供可引用ID。不得编造剧情、对白或动作。
景别、机位、构图、运镜、表演、动作物理和director_effect分别使用Schema中的字段；用简短可执行描述，不自创字段。
景别/剪辑变化应服务情绪、空间或信息变化；连续动作可在同镜完成。不重复复述原文。
无明确对白用[]；已有对白保留speaker和line，不丢弃台词。缺少创意细节可留空，等待用户完善。
lighting 必须是对象，使用key_source、color_tone、contrast、practical_sources；不增加光影字段。
shot duration_seconds为1–30整数秒或null，依照动作节奏估计；lighting_override_reason必须留空，独立光影由用户决定。
对照Director的daylight_phase与lighting_cues，原文黄昏不得无理由变成白天或夜晚；不按相似地点名或“黄昏”等词猜测关联。
延续只读场景的地点/时段光影基线；连续性不足写unresolved_questions。只读视觉风格摘要约束镜头的可见表达，不是返回字段。
地域视觉可以提出可选导演视觉锚点，须明确标记可选，不得伪装成已发生的剧本事实；没有承载位置写unresolved_questions。
information_design只描述当前来源支持的信息披露；三个事件数组只逐字复制allowed_story_events中的event_id，不自编或用标题替代。
没有事件依据时数组用[]并设needs_review；source_linked必须有source_event_ids。未知或未绑定实体保留待核验，不猜测替换。
当前节拍完整JSON最多6000字符，每个描述尽量不超过100字。只返回符合下方Schema的完整JSON，不输出解释、shot_id/order或用户决定字段。
{preset}
{guidance(entities.get('selected_creative_methods', []))}
{root_instruction}
<shot_output_contract>{encode(output_schema(profile, beat_only=beat_only))}</shot_output_contract>
<current_beat_plan>{encode(beat_plan or {})}</current_beat_plan>
<source_chunk ref="{source_ref}">{text}</source_chunk>
<confirmed_director_profile>{encode(profile)}</confirmed_director_profile>
<allowed_story_events>{encode(_event_catalog(profile))}</allowed_story_events>
<entities>{encode({k:v for k,v in entities.items() if k!='selected_creative_methods'})}</entities>
<read_only_style_context>{encode(style)}</read_only_style_context>
<previous_scene_handoff>{encode(previous_scene or {})}</previous_scene_handoff>'''
    rejected = ''
    issues = []
    category = 'contract_violation'
    for attempt in range(2):
        repair = ('\n仅修正上次JSON的全部契约问题，保留有效镜头与台词：\n' + '；'.join(issues)) if issues else ''
        messages = [{'role': 'system', 'content': prompt + repair}]
        if rejected:
            messages += [{'role':'assistant', 'content':rejected},
                         {'role':'user', 'content': '按以下逐项操作修正上条JSON，不输出修正说明：\n'
                          + '；'.join(issues) + '\n' + root_instruction}]
        else:
            messages.append({'role':'user', 'content':'按本步骤Schema返回完整JSON。' + root_instruction + repair})
        content = processor.llm.chat(messages=messages, response_format={'type':'json_object'},
                                     stream=True, timeout_seconds=DIRECTOR_SHOOTING_PLAN_TIMEOUT_SECONDS,
                                     max_retries=DIRECTOR_PROFILE_MAX_RETRIES,
                                     **({'model':model} if model else {})) or ''
        parsed = None
        try:
            parsed = parse_model_json_object(content)
        except ValueError:
            issues = ['JSON 格式错误：必须返回一个完整对象，不能截断或附加多个结果']
            category = 'invalid_json'
        else:
            admitted, audit = exclude_exact_style_echo(parsed, style) if beat_only else (parsed, [])
            issues = output_issues(admitted, profile, beat_only=beat_only)
            category = 'contract_violation'
            if not issues:
                parsed = admitted
                if beat_only:
                    scene = {k:copy.deepcopy(v) for k,v in beat_plan.items() if k!='beats'}
                    scene['continuity_out'] = parsed.get('continuity_out', '')
                    scene['beats'] = [{**{k:copy.deepcopy(v) for k,v in beat_plan['beats'][0].items()
                                         if k!='source_unit_ids'}, 'shots': parsed['shots']}]
                    result = {'scenes':[scene], 'unresolved_questions':parsed.get('unresolved_questions', [])}
                else:
                    result = parsed
                issues = contract_issues(result)
                if not issues:
                    # Missing editable descriptions get explicit blanks only
                    # after admission; malformed/unknown fields are never dropped.
                    for scene in result['scenes']:
                        for beat in scene['beats']:
                            for shot in beat['shots']:
                                for field in ('visual_intent','performance_action','action_physics','shot_size',
                                              'camera_angle','composition','camera_movement','ambient_sound'):
                                    shot.setdefault(field, '')
                                for field,default in (('lighting',{}),('duration_seconds',None),('dialogue',[]),
                                                      ('character_ids',[]),('prop_ids',[])):
                                    shot.setdefault(field, copy.deepcopy(default))
                    if audit:
                        result['generation_admission_audit'] = audit
                        logging.getLogger(__name__).info('Shooting input echo excluded: audit=%s', encode(audit))
                    return result
        logging.getLogger(__name__).warning('Shooting shot output rejected: attempt=%s category=%s response_chars=%s issues=%s',
                                            attempt+1, category, len(content), '；'.join(issues)[:900])
        rejected = content if isinstance(parsed, dict) and len(content) <= MAX_SHOT_REPAIR_CHARS else ''
    error = DirectorShootingChunkError(category, '；'.join(issues))
    error.shooting_contract_diagnostic = {'scope':'shots' if beat_only else 'chunk', 'category':category,
                                          'attempts':2, 'response_chars':len(content), 'issues':issues[:12]}
    raise error
