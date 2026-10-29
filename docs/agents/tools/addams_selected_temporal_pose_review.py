"""Source/baseline/fitted comparison for bounded selected-point pose fitting."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw
from addams_vlm_stream_probe import ROOT, FRAMES

parser = argparse.ArgumentParser()
parser.add_argument('--directory', type=Path, default=ROOT/'docs/agents/raw/2026-10-29-addams-selected-temporal-fit-v1')
args = parser.parse_args()
OUT = args.directory
report = json.loads((OUT/'report.json').read_text())
# Fixed-order report, show both experiments; no selection by heldout score.
edges = [(5,7),(7,9),(6,8),(8,10),(5,6),(5,11),(6,12),(11,12),
         (11,13),(13,15),(12,14),(14,16)]
frames = range(49,57)
for sf in frames:
    k, row = min(((k,r) for k,r in enumerate(report['frame_map']) if r['source_frame']==sf),
                 key=lambda pair:abs(pair[1]['timing_error_s']))
    sheet = Image.new('RGB',(1920,560),(18,20,24))
    draw = ImageDraw.Draw(sheet)
    for column,case in enumerate(report['cases']):
        for fitted in [False, True]:
            col = column*2 + int(fitted)
            image = Image.open(FRAMES/f'frame-{sf:03}.jpg').convert('RGB')
            d = ImageDraw.Draw(image)
            xy = case['projection_xy'][k] if fitted else report['baseline_projection_xy'][k]
            color = (255,220,40) if fitted else (180,120,255)
            for a,b in edges:
                d.line([tuple(xy[a]),tuple(xy[b])],fill=color,width=3)
            for point in case['scores']:
                if point['source_frame'] != sf:
                    continue
                x,y = point['xy']
                c = (255,80,180) if point['split']=='heldout' else (50,255,180)
                d.rectangle((x-7,y-7,x+7,y+7),outline=c,width=3)
            image.thumbnail((480,520))
            sheet.paste(image,(col*480,40))
            label = 'FITTED' if fitted else 'NATIVE BASELINE'
            draw.text((col*480+8,12),f'{label} | bound {case["bound_rad_per_component"]}rad',fill='white')
    draw.text((12,330),f'SOURCE {sf} / {(sf-1)/25:.2f}s / timing offset {row["timing_error_s"]:+.4f}s',fill='white')
    draw.text((12,355),'Green boxes: selected training targets. Pink boxes: frame51 held out of pose objective.',fill='white')
    sheet = sheet.crop((0,0,1920,390))
    sheet.save(OUT/f'comparison-{sf:03}.jpg',quality=92)
sections = []
if report.get('ankle_preservation_weight_px',0):
    sections.append('<li>本轮添加原恢复踝位置软先验；不是源真值或脚底接触约束。最大踝位移仍约50px，候选未通过验收。</li>')
for case in report['cases']:
    m = case['metrics']
    sections.append(f'<li>旋转分量限幅 {case["bound_rad_per_component"]} rad：训练点 RMSE {m["train"]["baseline_px"]:.2f} → {m["train"]["fitted_px"]:.2f}px；留出帧51 RMSE {m["heldout"]["baseline_px"]:.2f} → {m["heldout"]["fitted_px"]:.2f}px。</li>')
(OUT/'review.html').write_text('''<!doctype html><html lang="zh"><meta charset="utf-8"><title>选点后的腿部时序拟合</title><style>body{background:#17191c;color:#eee;font:16px/1.7 system-ui;margin:24px}img{width:100%}a{color:#9cf}</style><h1>源49–56帧 · 固定原生相机的腿部时序拟合</h1><p>每对左：原恢复（紫）；右：拟合（黄）。绿色框是用户选中的训练点；粉色框为未参与姿态目标函数的第51帧点。鞋底代理点不参与拟合、不锁脚。人体形状、根位置和整体朝向固定。</p><ul>'''+''.join(sections)+'''</ul><p>这是用户选点一致性检验，不能证明三维深度正确。上游模型见过整段视频；原相机和点位自身仍有误差。仅测试49–56帧，不外推到64帧腾空或后续切镜；未写入主链路。</p>'''+''.join(f'<figure><figcaption>源第{sf}帧</figcaption><img src="comparison-{sf:03}.jpg"></figure>' for sf in frames)+'</html>')
print(OUT/'review.html')
