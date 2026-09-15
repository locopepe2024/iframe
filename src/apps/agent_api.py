"""Canvas Agent MVP: multi-turn sessions backed by per-profile JSON."""
import json, os, threading, uuid
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from .identity import UserContext, require_user_context
from .comic_gen.llm_adapter import LLMAdapter
router = APIRouter(prefix="/agent", tags=["agent"]); _lock=threading.RLock()
def _path(c): os.makedirs('output/agent_sessions',exist_ok=True); return f'output/agent_sessions/{c.owner_profile_id}.json'
def _read(c):
 try:
  with open(_path(c),encoding='utf-8') as f:return json.load(f)
 except (FileNotFoundError,json.JSONDecodeError):return {}
def _write(c,d):
 p=_path(c); t=p+'.tmp'; open(t,'w',encoding='utf-8').write(json.dumps(d,ensure_ascii=False,indent=2)); os.replace(t,p)
def _now():return datetime.now(timezone.utc).isoformat()
def _pub(s):return {k:v for k,v in s.items() if k!='messages'}
class SessionCreate(BaseModel): title:str='新会话'; model:Optional[str]=None
class SessionPatch(BaseModel): title:Optional[str]=None; model:Optional[str]=None
class MessageCreate(BaseModel): content:str=Field(min_length=1); assets:list[dict]=Field(default_factory=list)
@router.get('/models')
def models(ctx:UserContext=Depends(require_user_context)):
 return {'models':[{'id':m,'api_model_id':m,'display_name':m,'provider':'uniart','capabilities':['chat']} for m in ('qwen3.8-flash','chatgpt-6','deepseek-v4','glm-5')]}
@router.get('/sessions')
def sessions(ctx:UserContext=Depends(require_user_context)): return {'sessions':[_pub(s) for s in _read(ctx).values()]}
@router.post('/sessions')
def create(b:SessionCreate,ctx:UserContext=Depends(require_user_context)):
 sid=str(uuid.uuid4()); s={'id':sid,'title':b.title,'model':b.model,'created_at':_now(),'updated_at':_now(),'messages':[]}; d=_read(ctx); d[sid]=s; _write(ctx,d); return {'session':_pub(s)}
@router.patch('/sessions/{sid}')
def patch(sid:str,b:SessionPatch,ctx:UserContext=Depends(require_user_context)):
 d=_read(ctx); s=d.get(sid)
 if not s: raise HTTPException(404,'session not found')
 if b.title is not None:s['title']=b.title
 if b.model is not None:s['model']=b.model
 s['updated_at']=_now(); _write(ctx,d); return {'session':_pub(s)}
@router.delete('/sessions/{sid}')
def delete(sid:str,ctx:UserContext=Depends(require_user_context)):
 d=_read(ctx)
 if sid not in d: raise HTTPException(404,'session not found')
 del d[sid]; _write(ctx,d); return {'ok':True}
@router.get('/sessions/{sid}/messages')
def messages(sid:str,ctx:UserContext=Depends(require_user_context)):
 s=_read(ctx).get(sid)
 if not s: raise HTTPException(404,'session not found')
 return {'messages':s['messages']}
@router.post('/sessions/{sid}/messages')
def send(sid:str,b:MessageCreate,ctx:UserContext=Depends(require_user_context)):
 d=_read(ctx); s=d.get(sid)
 if not s: raise HTTPException(404,'session not found')
 user={'id':str(uuid.uuid4()),'role':'user','content':b.content,'assets':b.assets,'created_at':_now()}; hist=[{'role':m['role'],'content':m['content']} for m in s['messages'][-30:]]+[{'role':'user','content':b.content}]
 try: answer=LLMAdapter().chat(hist,model=s.get('model'))
 except Exception as e: raise HTTPException(502,f'agent model failed: {e}')
 assistant={'id':str(uuid.uuid4()),'role':'assistant','content':answer,'created_at':_now()}; s['messages'] += [user,assistant]; s['updated_at']=_now(); _write(ctx,d)
 return {'user_message':user,'assistant_message':assistant,'session':_pub(s),'status':'completed'}
