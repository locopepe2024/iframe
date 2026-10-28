"""Package the layered diagnostic for local browser review (run on media)."""
import json,hashlib,subprocess,shutil
from pathlib import Path
import cv2,numpy as np
O=Path('/tmp/addams-pose/gvhmr-native-v1'); P=O/'review-package';P.mkdir(exist_ok=True)
d=json.loads((O/'native-layer-input.json').read_text());h=json.loads((O/'human-score.json').read_text());r=json.loads((O/'retarget-score.json').read_text())
edges=[(5,6),(5,7),(7,9),(6,8),(8,10),(5,11),(6,12),(11,12),(11,13),(13,15),(12,14),(14,16)]
F=O/'native-overlay-frames';F.mkdir(exist_ok=True)
for row,pts in zip(d['frame_map']['frames'],d['coco17_projected']):
    i=row['model_frame'];img=cv2.imread(str(O/'frames'/f'{i:03}.png'))
    for a,b in edges:cv2.line(img,tuple(np.rint(pts[a]).astype(int)),tuple(np.rint(pts[b]).astype(int)),(180,80,255),2)
    cv2.putText(img,f'Source {row["source_frame"]} | native projection',(12,25),cv2.FONT_HERSHEY_SIMPLEX,.65,(255,255,255),1)
    cv2.imwrite(str(F/f'{i:03}.png'),img)
def movie(folder,name):
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','30','-i',str(folder/'%03d.png'),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(P/name)],check=True)
movie(O/'frames','source.mp4');movie(F,'native-overlay.mp4')
for case in ['direction','rotation','rotation-limb-rest']:
    movie(O/f'{case}-frames',f'{case}.mp4')
    for sf in [49,51,53,58]:
        shutil.copy2(O/f'{case}-{sf:03}.png',P/f'{case}-{sf:03}.png')
        shutil.copy2(O/f'{case}-side-{sf:03}.png',P/f'{case}-side-{sf:03}.png')
for name in ['human-score.json','retarget-score.json','validation.json','frame-map.json','native-human-contact.png','native-motion.json']:
    shutil.copy2(O/name,P/name)
manifest={'source_sha256':d['frame_map']['source_sha256'],'source_fps':25,'model_fps':30,
          'source_range':[37,65],'review_range':[49,58],'review_points':42,
          'camera':'assumed static, focal=image diagonal, principal point=image center',
          'not_accepted':['world trajectory','floor','foot contact','lighting','anatomical plausibility'],
          'files':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(P.iterdir()) if p.is_file() and p.suffix!='.html' and p.name!='manifest.json'}}
(P/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
table=''.join(f'<tr><td>{label}</td><td>{value:.2f}</td></tr>' for label,value in [
    ('ViTPose 二维检测',h['vitpose']['rmse_px']),('原生 SMPL-X 投影',h['native']['rmse_px']),
    ('A 白模：关节方向',r['direction']['review_rmse_px']),('B 白模：完整旋转',r['rotation']['review_rmse_px']),
    ('C 白模：完整旋转＋肢体静止方向对齐',r['rotation-limb-rest']['review_rmse_px'])])
players=''.join(f'<figure><figcaption>{label}</figcaption><video controls muted loop preload="metadata" src="{name}.mp4"></video></figure>' for name,label in [
    ('source','源片'),('native-overlay','原生三维投影'),('direction','A：方向迁移'),('rotation','B：完整旋转'),('rotation-limb-rest','C：完整旋转＋静止方向对齐')])
images=''.join(f'<figure><figcaption>B 侧视 · 源第{sf}帧</figcaption><img src="rotation-side-{sf:03}.png"></figure>' for sf in [49,51,53,58])
(P/'review.html').write_text('''<!doctype html><html lang="zh"><meta charset="utf-8"><title>Addams 分层动作诊断</title>
<style>body{background:#16181d;color:#eee;font:16px system-ui;max-width:1400px;margin:28px auto;padding:20px}video,img{width:100%}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}figure{margin:0}figcaption{padding:10px}td,th{padding:8px 20px;border-bottom:1px solid #444}button{font:inherit;padding:8px}p{line-height:1.6}</style>
<h1>Addams：先检查原生人体，再检查白模迁移</h1>
<p>上下文源第37–65帧；核心第49–58帧。25fps源片按邻近帧重复到30Hz，没有生成中间动作。以下42个已确认可见骨关节点只用于评价，没有进入本次模型或迁移拟合；54、58帧没有有效评价点。</p>
<p>相机固定、焦距等于画幅对角线均是诊断假设。侧视相机跟随骨盆，仅用于检查形态。脚接触、世界轨迹、光影尚未验收。原生COCO回归关节与白模骨骼头不是完全相同的关节定义，阶段指标差值不能直接视为纯映射误差。</p>
<table><tr><th>阶段</th><th>人工点 RMSE / px（960×520）</th></tr>'''+table+'''</table>
<p><button id="play">从头播放全部</button> <button id="pause">暂停全部</button> <label>逐帧 <input id="frame" type="range" min="0" max="34" value="0"></label> <span id="source"></span></p>
<div class="grid">'''+players+'''</div><h2>同一动画的独立侧视</h2><div class="grid">'''+images+'''</div>
<h2>已有人工点对照：紫色原生投影，黄色人工点</h2><img src="native-human-contact.png">
<p><a href="manifest.json">资产与哈希</a> · <a href="human-score.json">关节残差</a> · <a href="retarget-score.json">迁移残差</a> · <a href="validation.json">数值检查</a></p>
<script>const frames='''+json.dumps(d['frame_map']['frames'])+''';const videos=[...document.querySelectorAll('video')];const slider=document.querySelector('#frame');function show(i){document.querySelector('#source').textContent='源第'+frames[i].source_frame+'帧 / '+frames[i].source_pts_s.toFixed(2)+'秒'}slider.oninput=()=>{const i=+slider.value;videos.forEach(v=>{v.pause();v.currentTime=i/30});show(i)};document.querySelector('#play').onclick=()=>videos.forEach(v=>{v.currentTime=0;v.play().catch(()=>{})});document.querySelector('#pause').onclick=()=>videos.forEach(v=>v.pause());show(0);</script></html>''')
print('PACKAGED',str(P),flush=True)
