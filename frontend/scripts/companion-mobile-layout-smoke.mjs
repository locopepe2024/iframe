// Local CSS layout regression checks; does not exercise API, microphone or WebRTC.
import {spawn} from 'node:child_process';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
const root = new URL('../', import.meta.url);
const css = (await Promise.all(['photos/photos.module.css','agent/chat.module.css'].map(file => readFile(new URL(`src/components/companion/${file}`, root),'utf8')))).join('\n');
const icon = '<svg width="24" height="24" aria-hidden="true"></svg>';
const button = (label, cls='') => `<button class="${cls}" aria-label="${label}">${icon}</button>`;
const fixtures = {
  settings: `<aside class="panel settingsPanel"><div class="settingsHeader"><h2>设置</h2><button aria-label="关闭设置">×</button></div>${Array.from({length:20},()=>'<label>小安的设置<input value="测试设置"></label>').join('')}<div class="settingsSaveRow"><button class="settingsSaveButton">保存设置</button></div></aside>`,
  calendar: `<dialog class="featureDialog"><header class="albumHeader"><h2>日记</h2>${button('关闭','albumIcon')}</header><div class="dialogBody"><div class="calendarToolbar">${button('上月','albumIcon')}<label>年月<input type="month" value="2026-10"></label>${button('下月','albumIcon')}<button>今天</button></div><div class="calendarGrid">${Array.from({length:35},(_,i)=>`<button><span>${i%31+1}</span><small class="calendarDayMark">✅</small></button>`).join('')}</div></div></dialog>`,
  viewer: `<dialog class="mediaViewer"><header class="albumHeader">${button('返回','albumIcon')}<span>1 / 12</span>${button('资料','albumIcon')}</header><div class="mediaStage"></div><footer class="viewerControls"><div class="albumHeader">${button('上一张')}<div class="zoomControls">${button('缩小')}<span>100%</span>${button('放大')}</div>${button('下一张')}</div><button>使用这张照片</button></footer></dialog>`,
  album: `<dialog class="mediaLibrary"><header class="albumHeader"><h2>相册</h2>${button('关闭','albumIcon')}</header><div class="filterChips"><span>拍摄日期：2026-10-20 至 2026-10-30</span><button>${'一个很长的照片故事关键词'.repeat(8)} ×</button></div><form class="albumSearch">${button('搜索','albumIcon')}<input placeholder="人物、地点或故事">${button('清除','albumIcon')}</form><div class="albumGrid">${Array.from({length:12},()=>'<button class="albumTile" style="height:120px">照片</button>').join('')}</div></dialog>`,
  chat: `<header class="header"><div class="assistantIdentity"><h1>🐶 小安</h1><span class="assistantStatus">正在处理…</span></div><div class="headerActions">${button('语音','headerIcon')}<button>更多</button></div></header><div class="stream"><article class="assistant"><p>${'verylongunbrokenmessage'.repeat(40)}</p></article></div><footer class="composer"><div class="inputPanel"><textarea rows="2"></textarea><div class="toolbar"><details><summary>创作</summary></details>${button('上传','albumButton')}<div class="composerActions">${button('停止播报')}${button('语音输入','voiceButton')}${button('发送','sendButton')}</div></div></div></footer><nav class="bottomNav">${['日记','广场','相册','我的'].map(t=>`<button>${icon}<span>${t}</span></button>`).join('')}</nav>`,
};
const profile = await mkdtemp(join(tmpdir(),'companion-layout-'));
let socket;
const chrome=spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try {
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);}catch{}if(port)break;await pause(100);}
  if(!port)throw Error('Chrome did not start');
  const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.once('open',r);socket.once('error',j);});
  let id=0;const pending=new Map();
  socket.on('message',raw=>{const msg=JSON.parse(raw);const entry=pending.get(msg.id);if(entry){pending.delete(msg.id);msg.error?entry.reject(Error(msg.error.message)):entry.resolve(msg.result);}});
  function send(method,params={}){return new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});socket.send(JSON.stringify({id:key,method,params}));});}
  const failures=[]; let cases=0;
  for(const [width,height] of [[320,568],[360,800],[390,844],[430,932],[844,390],[390,400]])for(const font of [16,24,32])for(const [name,body] of Object.entries(fixtures)){
    cases++;
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
    await send('Page.setDocumentContent',{frameId:(await send('Page.getFrameTree')).frameTree.frame.id,html:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html{font-size:${font}px}body{margin:0}${css}</style><main class="shell">${body}</main>`});
    const result=await send('Runtime.evaluate',{expression:`(()=>{document.querySelector('dialog')?.showModal();const target=document.querySelector('dialog')||document.querySelector('main');return {overflow:target.scrollWidth-target.clientWidth,offscreen:[...target.querySelectorAll('button,input,textarea,summary')].filter(e=>{const r=e.getBoundingClientRect();return r.width&& (r.left< -1||r.right>innerWidth+1)}).map(e=>e.getAttribute('aria-label')||e.tagName)}})()`,returnByValue:true});
    const value=result.result.value;
    if(value.overflow>1||value.offscreen.length)failures.push({name,width,height,font,...value});
  }
  console.log(JSON.stringify({cases,failures},null,2));
  if(failures.length)process.exitCode=1;
} finally {socket?.close();chrome.kill();await new Promise(r=>chrome.exitCode!==null||chrome.signalCode!==null?r():chrome.once('exit',r));await rm(profile,{recursive:true,force:true});}
