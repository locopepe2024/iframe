"""Isolated Qwen visual review; no automatic labels or animation edits."""
import argparse,base64,hashlib,io,json,os,time
from pathlib import Path
from dotenv import load_dotenv
from PIL import Image,ImageDraw
from openai import OpenAI
ROOT=Path(__file__).resolve().parents[3]
B=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package'
SYSTEM='你是动作捕捉质检员。只根据本次图像证据回答，不默认姿态估计正确。关节左右按人物自身解剖左右定义，无法辨认时写uncertain；不能用画面左右替代。单目遮挡不强行猜。不要编造精确3D坐标、焦距或关节旋转。返回一个JSON对象。'
PROMPT='''这是同一源视频第46到59帧的连续图像，25fps；每张前面给出源帧号和时间。仅分析主角。先描述这0.52秒中身体、手臂、双腿的连续变化，再解释第49帧在整个动作中的阶段。不要只依据单帧姿势命名动作。输出字段：summary；action_hypotheses（候选名称、证据源帧、反证、confidence）；frame49（action_phase、body_orientation、anatomical_left_leg、anatomical_right_leg、support_foot取left/right/both/airborne/uncertain、support_type取flat/forefoot/heel/uncertain、visible_evidence、occluded_parts、confidence）；contact_timeline（只写图像支持的区间，不补齐未知）；uncertainties；next_checks。confidence为0到1，数值是主观判断而非校准概率。不得将未知接触写成确定。'''
def digest(b):return hashlib.sha256(b).hexdigest()
def picture(path):
 raw=path.read_bytes();im=Image.open(io.BytesIO(raw)).convert('RGB');im.thumbnail((960,520));buf=io.BytesIO();im.save(buf,format='JPEG',quality=92);b=buf.getvalue()
 return {'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+base64.b64encode(b).decode()}},{'path':str(path.relative_to(ROOT)),'original_sha256':digest(raw),'submitted_sha256':digest(b),'submitted_size':list(im.size)}
def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--run',action='store_true');p.add_argument('--sheet',action='store_true');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=False)
 tasks=json.loads((B/'addams-full-joint-review-v1/tasks.json').read_text())['tasks'];items={t['source_frame']:t for t in tasks};content=[{'type':'text','text':PROMPT}];evidence=[]
 for sf in range(46,60):
  t=items[sf];img,meta=picture(B/'addams-full-joint-review-v1'/t['image']);meta.update(source_frame=sf,pts_s=(sf-1)/25);evidence.append(meta);content.extend([{'type':'text','text':f'源第{sf}帧，PTS={(sf-1)/25:.2f}s'},img])
 if a.sheet:
  sheet=Image.new('RGB',(1440,5*284),(28,28,28));draw=ImageDraw.Draw(sheet)
  for idx,sf in enumerate(range(46,60)):
   im=Image.open(B/'addams-full-joint-review-v1'/items[sf]['image']).convert('RGB');im.thumbnail((480,260));x=(idx%3)*480;y=(idx//3)*284;sheet.paste(im,(x,y+24));draw.text((x+8,y+5),f'SOURCE FRAME {sf} / {(sf-1)/25:.2f}s',fill='white')
  sheet.save(a.output/'source-sheet.jpg',quality=90);raw=(a.output/'source-sheet.jpg').read_bytes();content=[content[0],{'type':'image_url','image_url':{'url':'data:image/jpeg;base64,'+base64.b64encode(raw).decode()}}]
 model='qwen3.8-flash';manifest={'model_requested':model,'source_sha256':json.loads((B/'addams-full-joint-review-v1/tasks.json').read_text())['source_sha256'],'images':evidence,'human_labels_provided':False,'candidate_provided_in_source_pass':False,'source_fps':25,'input_mode':'labelled_contact_sheet' if a.sheet else 'sequential_images','limits':['Model visual opinions only; no labels automatically accepted.','Sequential images with timestamps, not native video ingestion.','No independent accuracy claim.']}
 if a.sheet:manifest['submitted_sheet']={'sha256':digest((a.output/'source-sheet.jpg').read_bytes()),'size':[1440,1420],'cell_size':[480,284]}
 (a.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');(a.output/'prompt.txt').write_text(SYSTEM+'\n'+PROMPT+'\n')
 if not a.run:return
 load_dotenv(ROOT/'.env');key=os.environ.get('UNIART_API_KEY')
 if not key:raise SystemExit('UNIART_API_KEY is not configured')
 client=OpenAI(api_key=key,base_url=os.getenv('UNIART_BASE_URL','https://uniart.fun/v1'),timeout=180,max_retries=0)
 def call(name,images,prompt):
  start=time.monotonic()
  try:
   r=client.chat.completions.create(model=model,messages=[{'role':'system','content':SYSTEM},{'role':'user','content':[{'type':'text','text':prompt}]+images}],max_tokens=5000)
   (a.output/(name+'-response.json')).write_text(r.model_dump_json(indent=2)+'\n');s=r.choices[0].message.content or '';(a.output/(name+'.txt')).write_text(s+'\n');print(json.dumps({'pass':name,'model_returned':r.model,'elapsed_s':round(time.monotonic()-start,2),'finish_reason':r.choices[0].finish_reason},ensure_ascii=False),flush=True);return s
  except Exception as e:
   info={'pass':name,'error_type':type(e).__name__,'status_code':getattr(e,'status_code',None),'elapsed_s':round(time.monotonic()-start,2)};(a.output/(name+'-error.json')).write_text(json.dumps(info,indent=2)+'\n');print(json.dumps(info),flush=True);return None
 source=call('source',content[1:],PROMPT+(' 画面合并为一张时间序列图，从左到右、从上到下阅读，各格标有源帧号。' if a.sheet else ''))
 if source is None:raise SystemExit(2)
 candidate=B/'addams-fullbody-reviewed-v1/front-049.png';img,meta=picture(candidate);manifest['candidate_image']=meta;(a.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 compare='''前14张为源第46到59帧的连续画面；最后一张为白模候选第49帧。仅比较这个候选单帧与源第49帧及其上下文，不推断白模其他帧。独立判断，不预设哪方正确。输出JSON：source_action_context、frame49_pose_differences（body_part、source_visible_evidence、candidate_visible_evidence、severity、uncertainty）、candidate_support_assessment、cannot_judge、suggested_constraints。不得因为体型外貌不同直接判动作错误；不得从单帧声称滑脚。'''
 compare+=(' 输入先是一张源时间序列图，左到右、上到下共14格；最后一张才是候选。' if a.sheet else '');(a.output/'compare-prompt.txt').write_text(compare+'\n');call('comparison',content[1:]+[{'type':'text','text':'以下仅为候选白模第49帧'},img],compare)
if __name__=='__main__':main()
