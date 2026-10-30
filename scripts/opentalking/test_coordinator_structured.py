import importlib.util,json,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('coordinator','/srv/lumenx/companion-coordinator/coordinator_service.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Response:
 def __init__(self,decision,finish='stop'): self.data={'choices':[{'message':{'content':json.dumps(decision)},'finish_reason':finish}]}
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def read(self): return json.dumps(self.data).encode()
class Tests(unittest.TestCase):
 def test_schema_and_typed_context(self):
  decision={'focus':'chat','action':'reply','need_clarification':False}
  with patch.object(m.urllib.request,'urlopen',return_value=Response(decision)) as send:
   result=m.coordinate({'input':'你好','workflow_context':{'focused_task':None,'album_tasks':[]}})
   self.assertEqual(result['source'],'model')
   body=json.loads(send.call_args.args[0].data)
   self.assertIsNone(json.loads(body['messages'][1]['content'])['workflow_context']['focused_task'])
   self.assertEqual(body['response_format']['schema'],m.DECISION_SCHEMA)
 def test_bad_action_and_truncation_fail(self):
  for decision,finish in [({'focus':'chat','action':'简短动作名','need_clarification':False},'stop'),({'focus':'chat','action':'reply','need_clarification':False},'length')]:
   with patch.object(m.urllib.request,'urlopen',return_value=Response(decision,finish)):
    with self.assertRaises(ValueError): m.coordinate({'input':'你好','workflow_context':{}})
 def test_commands_keep_existing_behavior(self):
  with patch.object(m.urllib.request,'urlopen') as send:
   self.assertEqual(m.coordinate({'input':'打开相册','workflow_context':{}})['focus'],'album')
   self.assertEqual(m.coordinate({'input':'写日记','workflow_context':{}})['focus'],'diary')
   send.assert_not_called()
unittest.main()
