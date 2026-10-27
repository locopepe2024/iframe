"""Single-round Qwen function proposals through the current user's UniArt channel."""
import json
import os
import sqlite3

import requests
from fastapi import HTTPException

from ..user_config import UserConfigStore
from .personality import get_profile, system_prompt
from .tools import tool_schemas, MODELS, DESCRIPTIONS, CAPABILITIES


class ModelUnavailable(RuntimeError):
    pass


WIRE_NAMES = {name.replace('.', '_'): name for name in MODELS}
def _propose(identity, messages, current_message_id, *, diary=False):
    path = os.getenv('IFRAME_COMPANION_USER_CONFIG_DB') or os.getenv('IFRAME_PHOTOS_USER_CONFIG_DB') or os.getenv('LUMENX_USER_DB_PATH')
    local_path = os.getenv('IFRAME_COMPANION_DB_PATH')
    if local_path:
        local = UserConfigStore(local_path)
        if local.get_public(identity)['secrets_configured']['UNIART_API_KEY']:
            path = local_path
    if not path:
        raise ModelUnavailable('Personal channel is not configured')
    try:
        store = UserConfigStore(path, read_only=True)
        if not store.get_public(identity)['secrets_configured']['UNIART_API_KEY']:
            raise HTTPException(409, '请先在创作台配置当前用户的 UniArt 渠道。')
        configured = store.get_runtime_uniart(identity)
    except (sqlite3.Error, OSError) as exc:
        raise ModelUnavailable('Personal channel unavailable') from exc
    model = os.getenv('IFRAME_COMPANION_QWEN_MODEL', 'qwen3.8-flash')
    if not configured['base_url'].startswith('https://') or not model.startswith('qwen'):
        raise ModelUnavailable('Invalid personal Qwen configuration')
    tools = [dict(type='function', function=dict(name=item['name'].replace('.', '_'),
                  description='只提出待用户按钮确认的请求' if item['effect']=='proposal_only' else DESCRIPTIONS.get(item['name'], '读取当前用户实际记忆'),
                  parameters=item['parameters'])) for item in tool_schemas()] if not diary else []
    try:
        profile = get_profile(os.getenv('IFRAME_COMPANION_PERSONALITY'))
        instruction = ('\n用户要求整理照片时用 photo_organize_start 委派工作流；只查找照片用 photo_album_list。workflow_tasks 是服务端提供的当前任务状态；用户继续选择、结束或取消时用 photo_organize_input，不重复发起。有多项任务或照片选择不明确时只问一个澄清问题。不要声称已完成分析或保存。') if not diary else ('\n这是回忆日记写作任务。只根据 user_messages 中已经说过的事实写一篇简短日记；'
            '如果事实不足，只提出一个最需要补充的问题。绝对不要查询、保存或删除个人记忆，也不要输出工具调用。')
        prompt = system_prompt(profile) + instruction
        if not diary:
            prompt += '\n你已注册以下站内能力，应按需求调用工具，不要声称无法打开站内相册或日记。外部手机相册仍需用户上传。\n' + json.dumps(CAPABILITIES, ensure_ascii=False)
        response = requests.post(configured['base_url'].rstrip('/')+'/chat/completions',
            headers={'Authorization': 'Bearer '+configured['api_key']},
            # Keep ordinary spoken/chat turns compact. Diary writing is an explicit
            # long-form task and retains the larger budget.
            json=dict(model=model, max_tokens=1600 if diary else 480, parallel_tool_calls=False,
                      messages=[dict(role='system',content=prompt),dict(role='user',content=json.dumps(dict(current_message_id=current_message_id,user_messages=messages),ensure_ascii=False)),
                                ],
                      **({'tools': tools} if tools else {})), timeout=(10,60))
        response.raise_for_status()
        result = response.json()['choices'][0]['message']
        if not isinstance(result,dict) or len(json.dumps(result))>32000:
            raise ValueError('Invalid model reply')
        calls = result.get('tool_calls') or []
        if calls:
            if len(calls)!=1 or calls[0].get('type')!='function':
                raise ValueError('One function only')
            function=calls[0]['function']
            name=WIRE_NAMES[function['name']]
            arguments=json.loads(function['arguments'])
            if not isinstance(arguments,dict):
                raise ValueError('Invalid arguments')
            return dict(kind='tool',name=name,arguments=arguments)
        text=result.get('content')
        if not isinstance(text,str) or not text.strip() or len(text)>4000:
            raise ValueError('Invalid text reply')
        return dict(kind='text',text=text)
    except (requests.RequestException,ValueError,KeyError,IndexError,TypeError) as exc:
        raise ModelUnavailable('Qwen request failed or returned an invalid proposal') from exc


def propose(identity, messages, current_message_id):
    return _propose(identity, messages, current_message_id)


def propose_diary(identity, messages, current_message_id):
    return _propose(identity, messages, current_message_id, diary=True)
