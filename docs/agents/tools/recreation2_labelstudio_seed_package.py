"""Build a non-annotated Label Studio seed package for six pose-review frames."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'docs/agents/raw/2026-10-28-motion-asset-package/label-studio-seed'
EVENTS=[1,17,23,29,41,55]
REPORT=ROOT/'docs/agents/raw/2026-10-22-independent-pose/report.json'
FRAME_DIR=ROOT/'docs/agents/raw/2026-10-22-independent-pose/frames'

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
    OUT.mkdir(parents=True,exist_ok=True)
    frames=json.loads(REPORT.read_text())['frames']
    tasks=[]; source_rows=[]
    for i,f in enumerate(frames):
        if f['source_frame'] not in EVENTS: continue
        p=FRAME_DIR/f'source-{i+1:02}.png'
        rel=str(p.relative_to(ROOT))
        item={'task_id':f'recreation2-event-{f["source_frame"]:03}', 'data':{
            'image':rel, 'clip_id':'recreation2-clip-exact10', 'source_frame':f['source_frame'],
            'source_pts_s':f['source_pts_s'], 'image_sha256':sha(p), 'image_width':1394, 'image_height':792,
            'annotation_scope':'knee_regions_support_foot_occlusion'}}
        tasks.append(item)
        source_rows.append({'task_id':item['task_id'],'source_frame':f['source_frame'],'source_pts_s':f['source_pts_s'],'image':rel,'image_sha256':sha(p)})
    (OUT/'image-review-tasks.json').write_text(json.dumps(tasks,indent=2,ensure_ascii=False)+'\n')
    (OUT/'source-frames.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in source_rows))
    (OUT/'image-review-config.xml').write_text('''<View>\n  <Header value="Source frame: $source_frame | PTS: $source_pts_s s"/>\n  <Image name="image" value="$image" zoom="true"/>\n  <RectangleLabels name="knee_region" toName="image">\n    <Label value="left_knee_visible" background="#16a34a"/>\n    <Label value="right_knee_visible" background="#2563eb"/>\n    <Label value="left_knee_uncertain" background="#f59e0b"/>\n    <Label value="right_knee_uncertain" background="#f97316"/>\n  </RectangleLabels>\n  <PolygonLabels name="support_foot" toName="image">\n    <Label value="left_support_foot" background="#7c3aed"/>\n    <Label value="right_support_foot" background="#db2777"/>\n    <Label value="foot_uncertain" background="#6b7280"/>\n  </PolygonLabels>\n  <Choices name="frame_status" toName="image" choice="single-radio">\n    <Choice value="reviewed"/>\n    <Choice value="occluded"/>\n    <Choice value="not_evaluable"/>\n  </Choices>\n  <TextArea name="review_notes" toName="image" editable="true"/>\n</View>\n''')
    (OUT/'temporal-action-task.template.json').write_text(json.dumps({'data':{'video':'STAGE_SOURCE_VIDEO_HERE','clip_id':'recreation2-clip-exact10','source_sha256':'6614a5f7afdc5dd7342058e99027f2f42eee19594dcfd90c46017ddcfce114c0','annotation_scope':'temporal_action_segments'}},indent=2)+'\n')
    (OUT/'temporal-action-config.draft.xml').write_text('''<!-- Draft: validate TimelineLabels against the deployed Label Studio version before import. -->\n<View>\n  <Video name="video" value="$video"/>\n  <TimelineLabels name="action_segment" toName="video">\n    <Label value="support_phase" background="#16a34a"/>\n    <Label value="foot_lift" background="#f59e0b"/>\n    <Label value="turning_phase" background="#2563eb"/>\n    <Label value="uncertain" background="#6b7280"/>\n  </TimelineLabels>\n  <TextArea name="action_description" toName="video" editable="true"/>\n</View>\n''')
    (OUT/'README.md').write_text('''# Label Studio seed package\n\nThis package contains six non-annotated image tasks for source frames 1, 17, 23, 29, 41 and 55. Paths are repository-relative and may need local-file staging for a Label Studio deployment. No human labels are fabricated.\n\n`temporal-action-config.draft.xml` is intentionally marked draft: verify `TimelineLabels` support and the deployed Label Studio version before importing. The temporal task references the source video by placeholder only.\n''')
    print(json.dumps({'tasks':len(tasks),'frames':EVENTS},indent=2))
if __name__=='__main__': main()
