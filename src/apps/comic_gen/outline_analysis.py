"""Bounded, source-grounded outline analysis with owner-local resumable checkpoints."""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
import re
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, ValidationError

from ...utils.llm_json import parse_model_json_object
from .models import ScriptEpisodeOutline, ScriptWritingPlanDraft

logger = logging.getLogger(__name__)
SOURCE_BATCH_CHARS = 3000
EPISODE_BATCH_CHARS = 5600
BLOCK_CHARS = 500
VERSION = 'outline-blocks-v1'
SETTING_FIELDS = ('background', 'style', 'point_of_view', 'characters', 'constraints')
SETTING_LABELS = dict(zip(SETTING_FIELDS, ('背景', '风格', '视角', '人物设定', '创作约束')))
_EPISODE_ANCHOR = re.compile(r'(?=第\s*[0-9一二三四五六七八九十百零〇两]+\s*(?:[—–\-~～至到]\s*[0-9一二三四五六七八九十百零〇两]+\s*)?集)')


class SourceSettings(BaseModel):
    background: list[str] = Field(default_factory=list)
    style: list[str] = Field(default_factory=list)
    point_of_view: list[str] = Field(default_factory=list)
    characters: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)


class EpisodeReferences(BaseModel):
    number: int = Field(ge=1, le=200)
    source_refs: list[str] = Field(min_length=1)


class SourceMap(BaseModel):
    settings: SourceSettings = Field(default_factory=SourceSettings)
    episodes: list[EpisodeReferences] = Field(default_factory=list)
    ignored_refs: list[str] = Field(default_factory=list)
    target_word_count: int | None = Field(default=None, ge=100, le=20000)


class EpisodeBatch(BaseModel):
    episodes: list[ScriptEpisodeOutline] = Field(min_length=1, max_length=2)
    missing_information: list[str] = Field(default_factory=list, max_length=100)
    suggestions: list[str] = Field(default_factory=list, max_length=100)


class EpisodeBatchValidationError(RuntimeError):
    """Bounded contract diagnostics, containing field paths and codes only."""

    def __init__(self, issues: list[dict[str, str]]):
        self.issues = issues[:12]
        detail = '、'.join(f'{item["field"]}: {item["type"]}' for item in self.issues[:3])
        super().__init__(f'分集规划格式或分集编号无效（{detail}），请重试本批次')


def needs_chunked_analysis(text: str) -> bool:
    return len(text) > 4000 or sum(1 for _ in _EPISODE_ANCHOR.finditer(text)) > 4


def _stage_failure(stage: str, exc: Exception) -> RuntimeError:
    error = RuntimeError(f'{stage}失败：{str(exc)[:160]}；重试会复用已保存结果')
    diagnostic = getattr(exc, 'llm_diagnostic', None)
    if isinstance(diagnostic, dict):
        error.llm_diagnostic = diagnostic
    return error


def source_blocks(text: str) -> list[dict[str, str]]:
    """Keep literal text, split packed episode listings, and never truncate a paragraph."""
    parts = []
    for line in text.splitlines(keepends=True):
        paragraphs = _EPISODE_ANCHOR.split(line) if sum(1 for _ in _EPISODE_ANCHOR.finditer(line)) > 1 else [line]
        for paragraph in paragraphs:
            parts.extend(paragraph[start:start + BLOCK_CHARS] for start in range(0, len(paragraph), BLOCK_CHARS))
    return [{'id': f'p{index:05d}', 'text': value} for index, value in enumerate(parts, 1)]


def source_batches(blocks: list[dict[str, str]]) -> list[list[dict[str, str]]]:
    batches, current, size = [], [], 0
    for block in blocks:
        if current and size + len(block['text']) > SOURCE_BATCH_CHARS:
            batches.append(current)
            current, size = [], 0
        current.append(block)
        size += len(block['text'])
    if current:
        batches.append(current)
    return batches


def validate_source_map(value: dict, blocks: list[dict[str, str]]) -> SourceMap:
    try:
        result = SourceMap.model_validate(value)
    except ValidationError as exc:
        raise RuntimeError('原文归属格式无效，请重新解析') from exc
    known = {block['id'] for block in blocks}
    used = set(result.ignored_refs)
    for refs in result.settings.model_dump().values():
        used.update(refs)
    for episode in result.episodes:
        used.update(episode.source_refs)
    if used - known:
        raise RuntimeError('原文引用包含不存在的段落，请重新解析')
    if known - used:
        raise RuntimeError(f'有 {len(known - used)} 个原文段落未归属，请重新解析')
    return result


def validate_episode_batch(value: dict, numbers: list[int]) -> list[dict]:
    try:
        result = EpisodeBatch.model_validate(value)
    except ValidationError as exc:
        # Pydantic's default message includes the user's screenplay input.
        issues = [{'field': '.'.join(map(str, error['loc'])), 'type': error['type']}
                  for error in exc.errors(include_input=False, include_context=False, include_url=False)]
        raise EpisodeBatchValidationError(issues) from exc
    if [episode.number for episode in result.episodes] != numbers:
        raise EpisodeBatchValidationError([{'field': 'episodes.number', 'type': 'episode_sequence'}])
    for index, episode in enumerate(result.episodes):
        for field in ('title', 'outline'):
            if not getattr(episode, field).strip():
                raise EpisodeBatchValidationError([{'field': f'episodes.{index}.{field}', 'type': 'string_blank'}])
    return [episode.model_dump() for episode in result.episodes]


def _compile_episode_batch(llm: Any, system: str, data: dict, model: str | None,
                           checkpoints: Checkpoints, name: str) -> tuple[dict, list[dict]]:
    value = checkpoints.get(name) or _chat(llm, system, data, model)
    try:
        return value, validate_episode_batch(value, data['episode_numbers'])
    except EpisodeBatchValidationError as exc:
        logger.warning('Outline episode contract rejected: numbers=%s issues=%s',
                       data['episode_numbers'], json.dumps(exc.issues))
        # One bounded correction of this batch only. Never locally coerce fields,
        # renumber episodes, or accept a partial plan. Transport/JSON errors are
        # not contract failures and are left for the existing resumable retry.
        repair_data = {**data, 'contract_errors': exc.issues}
    value = _chat(llm, system + '\n上次本批次返回未通过字段校验。根据contract_errors和原文重新整理本批次，'
                  '修正字段格式，保持episode_numbers中的集数与顺序，不能省略或新增集数。', repair_data, model)
    try:
        return value, validate_episode_batch(value, data['episode_numbers'])
    except EpisodeBatchValidationError as exc:
        logger.warning('Outline episode correction rejected: numbers=%s issues=%s',
                       data['episode_numbers'], json.dumps(exc.issues))
        raise


class Checkpoints:
    def __init__(self, cache_dir: Path | None, text: str, model: str | None):
        digest = hashlib.sha256(json.dumps([VERSION, model, text], ensure_ascii=False).encode()).hexdigest()
        self.directory = Path(cache_dir) / digest if cache_dir else None

    def get(self, name: str) -> dict | None:
        if self.directory is None:
            return None
        path = self.directory / (name + '.json')
        if not path.exists():
            return None
        try:
            value = json.loads(path.read_text(encoding='utf-8'))
            return value if isinstance(value, dict) else None
        except (ValueError, OSError):
            logger.warning('Outline checkpoint could not be read: phase=%s', name)
            return None

    def put(self, name: str, value: dict) -> None:
        if self.directory is None:
            return
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = self.directory / (name + '.json')
        temporary = path.with_name('.' + path.name + '.' + uuid4().hex)
        try:
            with temporary.open('x', encoding='utf-8') as output:
                temporary.chmod(0o600)
                output.write(json.dumps(value, ensure_ascii=False))
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)


def _chat(llm: Any, system: str, data: dict, model: str | None) -> dict:
    messages = [{'role': 'system', 'content': system},
                {'role': 'user', 'content': json.dumps(data, ensure_ascii=False)}]
    logger.info('Outline analysis stage=%s input_chars=%d', data['stage'], sum(len(m['content']) for m in messages))
    options = {'model': model} if model else {}
    output = llm.chat(messages=messages, response_format={'type': 'json_object'},
                      timeout_seconds=900, max_retries=1, stream=True, **options).strip()
    try:
        return parse_model_json_object(output)
    except ValueError as exc:
        raise RuntimeError('模型返回的 JSON 不完整或格式无效，请重试本段或切换剧本模型') from exc


def _compact(llm: Any, text: str, label: str, limit: int, model: str | None,
             checkpoints: Checkpoints) -> str:
    """Reduce oversized evidence in bounded calls; retain literal episode sources separately."""
    current = text
    for level in range(6):
        if len(current) <= limit:
            return current
        parts = source_batches(source_blocks(current))
        summaries = []
        for index, blocks in enumerate(parts):
            data = {'stage': 'compact_context', 'field': label, 'source_blocks': blocks}
            digest = hashlib.sha256(json.dumps(data, ensure_ascii=False).encode()).hexdigest()[:24]
            name = 'compact-' + digest
            result = checkpoints.get(name) or _chat(llm,
                '整理这部分剧本资料中的已知事实。保留人物动机、关系、事件顺序、对白要点和创作约束，不增加新事实。'
                '最多概括为600个中文字符，返回JSON对象 {"text":"事实摘要"}。', data, model)
            summary = result.get('text')
            if not isinstance(summary, str) or not summary.strip() or len(summary) > 900:
                raise RuntimeError('分段事实摘要不完整或过长，请重试本段')
            checkpoints.put(name, result)
            summaries.append(summary.strip())
        next_text = '\n'.join(summaries)
        if len(next_text) >= len(current):
            raise RuntimeError('分段事实摘要未收敛，请精简对应总纲章节后重试')
        current = next_text
    raise RuntimeError('总纲章节过长，请精简对应章节后重试')


def analyze_chunked_outline(llm: Any, text: str, *, model: str | None = None,
                            cache_dir: Path | None = None) -> dict:
    blocks = source_blocks(text)
    batches = source_batches(blocks)
    checkpoints = Checkpoints(cache_dir, text, model)
    setting_refs = {key: set() for key in SETTING_FIELDS}
    episode_refs: dict[int, set[str]] = {}
    word_counts = set()
    map_system = (
        '你是剧本总纲资料归属助手。这是总纲的一段，先识别原文段落属于全局设定还是哪几集，不写剧本，不扩写剧情。'
        'settings中只填对应全局设定的段落ID；episodes每项只填集数和source_refs，不复述原文。'
        '每个source_blocks段落ID都必须归入settings、episodes或ignored_refs；ignored_refs只用于空白、排版、分隔线或无实质内容的标题。'
        '人物共同设定可以同时归入characters和该人物涉及的各集；明确属于第2集的对白、破局或信物不得分给第1集。'
        '紧接集标题后的动作、对白、恋爱/情绪节点与信物都归入该集。保留原定集数，不能把共24集的数量声明当成第24集剧情。'
        'preceding_context和preceding_episode_numbers仅供理解跨段人物或集数归属，当前原文标题优先，不返回前段的ID。只有原文明示全剧统一单集字数时才填写target_word_count，否则null；不能从分钟换算。'
        '只返回符合schema的JSON，不附加解释：\n' + json.dumps(SourceMap.model_json_schema(), ensure_ascii=False)
    )
    prior_blocks: list[dict[str, str]] = []
    prior_episodes: list[int] = []
    for index, batch in enumerate(batches, 1):
        name = f'map-{index:04d}'
        try:
            value = checkpoints.get(name) or _chat(llm, map_system,
                {'stage': 'map_source', 'fragment': index, 'fragments': len(batches),
                 'preceding_context': prior_blocks[-2:], 'preceding_episode_numbers': prior_episodes, 'source_blocks': batch}, model)
            mapped = validate_source_map(value, batch)
            checkpoints.put(name, value)
        except Exception as exc:
            raise _stage_failure(f'总纲第 {index}/{len(batches)} 段解析', exc) from exc
        for key, refs in mapped.settings.model_dump().items():
            setting_refs[key].update(refs)
        for episode in mapped.episodes:
            episode_refs.setdefault(episode.number, set()).update(episode.source_refs)
        if mapped.target_word_count:
            word_counts.add(mapped.target_word_count)
        for block in reversed(batch):
            owners = sorted({ep.number for ep in mapped.episodes if block['id'] in ep.source_refs})
            if owners:
                prior_episodes = owners
                break
        prior_blocks.extend(batch)
    declared = re.search(r'(?:共|全剧)\s*(\d+)\s*集', text)
    anchor_numbers = [int(value) for match in re.finditer(
        r'第\s*(\d+)\s*(?:[—–\-~～至到]\s*(\d+)\s*)?集', text)
        for value in match.groups() if value]
    count = int(declared.group(1)) if declared else max(anchor_numbers, default=max(episode_refs, default=0))
    if not 1 <= count <= 200 or sorted(episode_refs) != list(range(1, count + 1)):
        raise RuntimeError(f'总纲约定 {count} 集，但分段原文归属缺失或分集编号无效，请检查各集标题和素材归属后重新解析')
    if len(word_counts) > 1:
        raise RuntimeError('原文的全剧统一单集字数存在冲突，请核对后重新解析')
    def literal(refs: set[str]) -> str:
        return ''.join(block['text'] for block in blocks if block['id'] in refs)
    settings = {}
    limits = {'background': 8000, 'style': 4000, 'point_of_view': 4000, 'characters': 10000, 'constraints': 8000}
    for key, refs in setting_refs.items():
        try:
            settings[key] = _compact(llm, literal(refs), key, limits[key], model, checkpoints)
        except Exception as exc:
            raise _stage_failure(f'全局{SETTING_LABELS[key]}整理', exc) from exc
    excerpts, evidence = {}, {}
    for number, refs in sorted(episode_refs.items()):
        excerpts[number] = literal(refs)
        if len(excerpts[number]) > 16000:
            raise RuntimeError(f'第 {number} 集原文素材超过16000字符，请整理该集素材后重新解析；已保存成功分段')
        try:
            evidence[number] = _compact(llm, excerpts[number], f'episode-{number}', EPISODE_BATCH_CHARS // 2, model, checkpoints)
        except Exception as exc:
            raise _stage_failure(f'第 {number} 集原文素材整理', exc) from exc
    episode_schema = EpisodeBatch.model_json_schema()
    episode_schema['$defs']['ScriptEpisodeOutline']['properties'].pop('source_excerpt', None)
    compile_system = (
        '你是剧本写作规划助手，只整理episode_numbers指定的这批分集规划，不生成剧本正文，不做导演分析或分镜。'
        '按原文保留既定分集标题、事件顺序、开场、结尾、人物动机与出场人物。标题速览/分集目录中的正式标题优先于“第1集·调教”这类段落标签。'
        '同一人物涉及两集时要分清归属，不能提前写后续集破局。未确定的信息留空，不发明事实。'
        '本批各集按episode_numbers顺序返回，不能缺集或多集。outline概括本集约200字，opening_state和ending_state各约80字。'
        '不确定的本集设定留空并写入missing_information，补充建议仅写入suggestions，不混入已知事实。'
        'title、outline、opening_state、ending_state、characters均为字符串，characters用一段文字列出本集人物，不能返回数组或对象。'
        '未知的可选文本用空字符串，不能用null；title和outline不能为空。number必须使用episode_numbers中的整数编号。'
        'missing_information和suggestions为字符串数组，无内容时返回[]。'
        'target_word_count默认使用default_target_word_count，仅原文明确本集字数时覆盖，不按分钟换算。'
        '不返回source_excerpt，程序会保留引用的原文，不需要抄写原文对白。只返回符合schema的JSON：\n'
        + json.dumps(episode_schema, ensure_ascii=False)
    )
    episodes = []
    missing = [f'全局设定缺少{SETTING_LABELS[key]}' for key in SETTING_FIELDS if not settings[key]]
    suggestions = []
    numbers = sorted(episode_refs)
    for start in range(0, len(numbers), 2):
        selected = numbers[start:start + 2]
        name = 'episodes-' + '-'.join(map(str, selected))
        try:
            value, batch_episodes = _compile_episode_batch(llm, compile_system,
                {'stage': 'compile_episodes', 'episode_numbers': selected,
                 'default_target_word_count': next(iter(word_counts), 2000),
                 'episode_sources': [{'number': n, 'text': evidence[n]} for n in selected]}, model, checkpoints, name)
            checkpoints.put(name, value)
            missing.extend(value.get("missing_information", []))
            suggestions.extend(value.get("suggestions", []))
            for episode in batch_episodes:
                episode['source_excerpt'] = excerpts[episode['number']]
                episodes.append(episode)
        except Exception as exc:
            raise _stage_failure(f'第 {selected[0]}—{selected[-1]} 集规划', exc) from exc
    try:
        draft = ScriptWritingPlanDraft(**settings, episodes=episodes,
            missing_information=list(dict.fromkeys(missing)), suggestions=list(dict.fromkeys(suggestions)))
    except ValidationError as exc:
        raise RuntimeError('总纲分段汇总字段无效，请重新解析') from exc
    return {'draft': draft.model_dump(), 'source_hash': hashlib.sha256(text.encode()).hexdigest()}
