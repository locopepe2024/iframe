"""Create interval-based review tasks without conflating detections and identity."""
import gzip,json,math,hashlib,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
BASE=Path(__file__).resolve().parents[3]/'docs/agents/raw/2026-10-28-motion-asset-package'
OUT=BASE/'addams-segment-review-v1'

def intervals(rows,reason):
    groups=[]
    for r in rows:
        if reason not in r['reasons']:continue
        if groups and groups[-1]['last_frame']+1==r['source_frame'] and groups[-1]['segment_id']==r['segment_id']:
            groups[-1]['last_frame']=r['source_frame']
        else:groups.append({'reason':reason,'segment_id':r['segment_id'],'first_frame':r['source_frame'],'last_frame':r['source_frame']})
    for g in groups:g['review_frame']=(g['first_frame']+g['last_frame'])//2
    return groups

def classify(row):
    sf=row['source_frame'];mp=row['mp_people'];det=row['independent_people'];reasons=[]
    # Reviewed visual tail span is an explicit annotation, not detector output.
    if sf>=175:return {'source_frame':sf,'pts_s':row['pts_s'],'segment_id':row['segment_id'],'target_status':'out_of_frame_visual_review','reasons':[]}
    if not mp:reasons.append('mp_missing')
    if not det:reasons.append('independent_missing')
    if len(det)>1 or len(mp)>1:reasons.append('multiple_proposals')
    if sf>=159:reasons.append('target_identity_review')
    if not reasons and len(mp)==len(det)==1:
        # A discrepancy flag only: single detection still does not establish identity.
        names=[(11,5),(12,6),(23,11),(24,12),(25,13),(26,14),(27,15),(28,16)]
        delta=[math.dist([mp[0]['landmarks'][a]['x']/4,mp[0]['landmarks'][a]['y']/4],[v/4 for v in det[0]['coco17_xy'][b]]) for a,b in names if mp[0]['landmarks'][a]['visibility']>=.5 and det[0]['scores'][b]>=.5]
        if delta and math.sqrt(sum(d*d for d in delta)/len(delta))>30:reasons.append('model_disagreement_gt30_review_px')
    return {'source_frame':sf,'pts_s':row['pts_s'],'segment_id':row['segment_id'],'target_status':'unassigned','reasons':reasons}

def main():
    data=json.loads(gzip.decompress((OUT/'observations.json.gz').read_bytes()));report=json.loads((OUT/'report.json').read_text())
    assert len(data)==report['frame_count']==217
    assert [r['source_frame'] for r in data]==list(range(1,218))
    assert all(b['pts_s']>a['pts_s'] for a,b in zip(data,data[1:]))
    rows=[classify(r) for r in data];reasons=sorted({s for r in rows for s in r['reasons']});tasks=[g for s in reasons for g in intervals(rows,s)]
    # Interval bundling keeps source provenance; no interpolation of missing poses.
    selected=sorted(set([1,65,66,86,87,113,139,158,159,170,174,175,217]+[t['review_frame'] for t in tasks if t['reason'] in ['mp_missing','independent_missing','multiple_proposals']]))
    summary=[]
    for seg in report['segments']:
        subset=[r for r in rows if r['segment_id']==seg['id']]
        summary.append({**seg,'review_frames':sum(bool(r['reasons']) for r in subset),'visually_out_of_frame':sum(r['target_status']=='out_of_frame_visual_review' for r in subset),
                        'reason_counts':{reason:sum(reason in r['reasons'] for r in subset) for reason in reasons}})
    output={'schema':'addams-review-queue.v1','source_sha256':report['source_sha256'],
            'inputs_sha256':{n:hashlib.sha256((OUT/n).read_bytes()).hexdigest() for n in ['observations.json.gz','report.json']},
            'parameters':{'model_disagreement_threshold_review_px':30,'review_size':[960,520],'confidence_filter':.5},
            'visual_review':{'cut_first_frames':[66,159],'protagonist_out_of_frame':[175,217],'protagonist_partial_exit_frame':174,
                             'note':'Agent visual review, separate from user joint annotations; all tail173–217 thumbnails inspected.'},
            'summary':summary,'frames':rows,'tasks':tasks,'contact_sheet_source_frames':selected,
            'limits':['Risk thresholds are review heuristics, not accuracy gates.','Detection identity remains unassigned; do not retarget shot3 directly.',
                      'Missing detection is not equivalent to occlusion/absence.','No new3D motion/contact acceptance.']}
    (OUT/'review-queue.json').write_text(json.dumps(output,indent=2)+'\n')
    source=Path(json.loads((BASE/'addams-source-clip.json').read_text())['path']);framesdir=OUT/'risk-frames';framesdir.mkdir(exist_ok=True)
    expr='+'.join(f'eq(n\\,{sf-1})' for sf in selected)
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(source),'-vf',f'select={expr},scale=480:-1','-fps_mode','vfr',str(framesdir/'review-%03d.jpg')],check=True)
    sheet=Image.new('RGB',(1920,math.ceil(len(selected)/4)*290),'#222222')
    for i,sf in enumerate(selected):
        im=Image.open(framesdir/f'review-{i+1:03}.jpg').convert('RGB');draw=ImageDraw.Draw(im);record=data[sf-1]
        for person in record['independent_people']:
            box=[x/8 for x in person['box_xyxy']];draw.rectangle(box,outline='#2dd4bf',width=2)
        sheet.paste(im,((i%4)*480,(i//4)*290+30));label=f'F{sf} {record["pts_s"]:.2f}s D{len(record["independent_people"])} MP{len(record["mp_people"])}'
        ImageDraw.Draw(sheet).text(((i%4)*480+4,(i//4)*290+5),label,fill='white')
    sheet.save(OUT/'risk-contact-sheet.jpg');print(json.dumps({'summary':summary,'review_intervals':len(tasks),'selected_frames':selected},indent=2))

if __name__=='__main__':main()
