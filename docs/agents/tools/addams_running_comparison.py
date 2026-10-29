"""Assemble source/baseline/root-candidate preview without changing timing."""
from pathlib import Path
import subprocess
from PIL import Image,ImageDraw
from addams_vlm_stream_probe import ROOT,FRAMES

OUT=ROOT/'docs/agents/raw/2026-10-29-addams-running-continuous-v2'
folder=OUT/'comparison'
folder.mkdir(exist_ok=True)
for i,sf in enumerate(range(58,66),1):
    sheet=Image.new('RGB',(1440,300),(25,25,25))
    draw=ImageDraw.Draw(sheet)
    for column,(label,path) in enumerate([
        ('SOURCE',FRAMES/f'frame-{sf:03}.jpg'),
        ('BASELINE',OUT/'baseline'/f'{i:03}.png'),
        ('ROOT CANDIDATE / ASSUMED 1cm',OUT/'flight-1cm'/f'{i:03}.png')]):
        image=Image.open(path).convert('RGB');image.thumbnail((480,260))
        sheet.paste(image,(column*480,40))
        draw.text((column*480+8,10),f'{label} / SOURCE {sf}',fill='white')
    sheet.save(folder/f'{i:03}.png')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','25','-i',str(folder/'%03d.png'),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p',str(OUT/'comparison-25fps.mp4')],check=True)
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-framerate','5','-i',str(folder/'%03d.png'),'-c:v','libx264','-crf','18','-pix_fmt','yuv420p',str(OUT/'comparison-slow-5fps.mp4')],check=True)
(OUT/'review.html').write_text('''<!doctype html><html lang="zh"><meta charset="utf-8"><title>快跑腾空连续对照</title><style>body{background:#17191c;color:white;font:16px/1.6 system-ui;margin:24px}video,img{max-width:100%}a{color:#9cf}</style><h1>源58–65帧：快跑腾空连续对照</h1><p>左：源画面；中：原恢复；右：根高度候选。相同rig和相机，未新增脚锁。第64帧1cm间隙为演示假设，非源真实测量。65→66切镜，本片没有落地验收。</p><h2>源速度25fps</h2><video controls loop src="comparison-25fps.mp4"></video><h2>五倍慢放，仅便于检查</h2><video controls loop src="comparison-slow-5fps.mp4"></video><h2>第64帧</h2><img src="comparison/007.png"><p>候选只修根高度；原肢体姿势、比例、镜头及地面仍需验证。消除穿地不等于动作复刻通过。</p></html>''')
