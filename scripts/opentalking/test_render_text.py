"""Verify the deployed-source overlay with forbidden LLM and captured queue tasks."""
import ast
import asyncio
import hashlib
import json
import sys
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

root = Path(sys.argv[1])
runner = ast.parse((root / 'opentalking/pipeline/speak/synthesis_runner.py').read_text())
service = ast.parse((root / 'apps/api/services/session_service.py').read_text())

async def main():
    reply = next(node for node in ast.walk(runner) if isinstance(node, ast.AsyncFunctionDef) and node.name == 'reply_source')
    class LLM:
        def __init__(self): self.calls = 0
        async def chat_stream(self, messages):
            self.calls += 1
            yield 'legacy'
    llm = LLM()
    class Runner: pass
    owner = Runner(); owner.llm = llm
    scope = dict(render_text=True, text='今天女儿来看我了。', self=owner, _llm_request_messages=lambda: [])
    exec(compile(ast.fix_missing_locations(ast.Module(body=[reply], type_ignores=[])), 'reply_source', 'exec'), scope)
    result = [piece async for piece in scope['reply_source']()]
    assert result == ['今天女儿来看我了。'] and llm.calls == 0
    scope['render_text'] = False
    assert [piece async for piece in scope['reply_source']()] == ['legacy'] and llm.calls == 1

    fn = next(node for node in service.body if isinstance(node, ast.AsyncFunctionDef) and node.name == 'speak')
    fn.returns = None
    for arg in fn.args.args + fn.args.kwonlyargs: arg.annotation = None
    class Redis:
        async def set(self, *args, **kwargs): return True
    push = AsyncMock()
    scope = dict(uuid=uuid, hashlib=hashlib, json=json, command_receipt_key=lambda *args: 'receipt',
                 _await_result=lambda value: value, interrupt=AsyncMock(), _push_task=push,
                 time=__import__('time'))
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), 'speak', 'exec'), scope)
    await scope['speak'](Redis(), 'test', '原文', render_text=True)
    assert push.await_args.args[1]['render_text'] is True
    await scope['speak'](Redis(), 'test', '旧行为')
    assert 'render_text' not in push.await_args.args[1]
    print('PASS: literal reply skips LLM; legacy invokes LLM; render flag enters queue; legacy task unchanged')

asyncio.run(main())
