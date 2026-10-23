"""Single-round Qwen function proposals through the current user's UniArt channel."""
import json
import os
import sqlite3

import requests
from fastapi import HTTPException

from ..user_config import UserConfigStore
from .personality import get_profile, system_prompt
from .tools import tool_schemas


class ModelUnavailable(RuntimeError):
    pass


WIRE_NAMES = {name.replace('.', '_'): name for name in ('memory.save','memory.search','memory.list','memory.delete')}
def propose(identity, messages, current_message_id):
    path = os.getenv('IFRAME_COMPANION_USER_CONFIG_DB') or os.getenv('IFRAME_PHOTOS_USER_CONFIG_DB') or os.getenv('LUMENX_USER_DB_PATH')
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
                  description='只提出待用户按钮确认的请求' if item['effect']=='proposal_only' else '读取当前用户实际记忆',
                  parameters=item['parameters'])) for item in tool_schemas()]
    try:
        profile = get_profile(os.getenv('IFRAME_COMPANION_PERSONALITY'))
        response = requests.post(configured['base_url'].rstrip('/')+'/chat/completions',
            headers={'Authorization': 'Bearer '+configured['api_key']},
            json=dict(model=model, max_tokens=1600, parallel_tool_calls=False,
                      messages=[dict(role='system',content=system_prompt(profile)),dict(role='user',content=json.dumps(dict(current_message_id=current_message_id,user_messages=messages),ensure_ascii=False))],
                      tools=tools), timeout=(10,60))
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
