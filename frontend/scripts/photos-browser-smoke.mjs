#!/usr/bin/env node
// Real local API + exported webpage; simulated speech APIs, not microphone/audio.
// Uses temporary synthetic images and DB. No recordings or screenshots are saved.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let directory, backend, chrome, socket;
try {
  if (!existsSync(path.join(root, "static/companion/photos.html"))) throw Error("Run npm run build first");
  directory = await mkdtemp(path.join(os.tmpdir(), "iframe-photo-web-"));
  const python = `
import os, socket, sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from PIL import Image
import uvicorn
from src.apps.photos.api import create_app
from src.apps.photos.date_store import DateStore
folder = Path(sys.argv[1])
database = folder / 'photos.db'
DateStore(database)
os.environ['IFRAME_PHOTOS_LOCAL_DB_PATH'] = str(database)
exif = Image.Exif()
exif[34665] = {36867: '1985:06:07 08:09:10'}
Image.new('RGB', (80, 40), 'red').save(folder / 'photo.jpg', exif=exif)
Image.new('RGB', (40, 80), 'blue').save(folder / 'unknown.png')
app = FastAPI()
app.mount('/photo-demo-api', create_app())
app.mount('/static', StaticFiles(directory=str(Path.cwd() / 'static'), html=True))
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
print(sock.getsockname()[1], flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='error')).run(sockets=[sock])
`;
  backend = spawn(path.join(root, ".venv/bin/python"), ["-c", python, directory], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let backendOutput = "", backendErrors = "";
  backend.stdout.on("data", data => { backendOutput += data; });
  backend.stderr.on("data", data => { backendErrors += data; });
  backend.on("error", error => { backendErrors += error.message; });
  for (let i = 0; i < 100 && !/^\d+\n/.test(backendOutput); i++) {
    if (backend.exitCode !== null) throw Error(`Backend failed: ${backendErrors}`);
    await pause(100);
  }
  const port = Number(backendOutput.split("\n")[0]);
  if (!port) throw Error(`Backend not ready: ${backendErrors}`);
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${origin}/photo-demo-api/openapi.json`)).ok) { ready = true; break; } } catch {}
    await pause(100);
  }
  if (!ready) throw Error(`Backend did not start: ${backendErrors}`);
  const profile = path.join(directory, "chrome");
  chrome = spawn(chromePath, ["--headless=new", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-sync", "--remote-debugging-port=0",
    `--user-data-dir=${profile}`, "about:blank", ...(process.platform === "linux" ? ["--no-sandbox"] : [])], { stdio: "ignore" });
  let chromeError = "";
  chrome.on("error", error => { chromeError = error.message; });
  let debugPort;
  for (let i = 0; i < 150; i++) {
    try { debugPort = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); if (debugPort) break; } catch {}
    if (chromeError || chrome.exitCode !== null) throw Error(`Chrome failed: ${chromeError}`);
    await pause(100);
  }
  if (!debugPort) throw Error("Chrome not ready");
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  let id = 0; const pending = new Map(); const errors = []; const blocked = [];
  const dateWrites = [];
  let dateUrl, identityHeaders;
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const key = ++id;
      const timeout = setTimeout(() => { pending.delete(key); reject(Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(key, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id: key, method, params }));
    });
  }
  socket.on("message", raw => {
    const message = JSON.parse(raw);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.method === "Fetch.requestPaused") {
      const url = new URL(message.params.request.url);
      const request = message.params.request;
      if (url.origin === origin && url.pathname.endsWith('/organize-time')) {
        dateUrl = url.href.replace(/organize-time$/, 'date');
        identityHeaders = Object.fromEntries(Object.entries(request.headers).filter(([name]) =>
          /^(authorization|cookie|x-)/i.test(name)));
      }
      if (url.origin === origin && request.method === 'PATCH' && url.pathname.endsWith('/date')) {
        dateWrites.push(JSON.parse(request.postData));
      }
      const allowed = url.origin === origin || ["data:", "blob:"].includes(url.protocol)
        || ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname);
      if (!allowed) blocked.push(url.href);
      void send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", {
        requestId: message.params.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}),
      }).catch(error => errors.push(error.message));
    }
    const waiting = pending.get(message.id);
    if (waiting) {
      clearTimeout(waiting.timeout); pending.delete(message.id);
      if (message.error) waiting.reject(Error(message.error.message)); else waiting.resolve(message.result);
    }
  });
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || "Browser evaluation failed");
    return result.result?.value;
  }
  async function wait(label, expression) {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); }
    throw Error(`Timed out: ${label}; ${await evaluate("document.body.innerText")}`);
  }
  const button = label => `[...document.querySelectorAll('button,label')].find(b => (b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}) && !b.disabled)`;
  async function tap(label) {
    await wait(label, `!!(${button(label)})`);
    let point;
    for (let attempt = 0; attempt < 10; attempt++) {
      await evaluate(`(${button(label)}).scrollIntoView({block:'center',behavior:'instant'})`);
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      point = await evaluate(`(() => { const b = ${button(label)}; const r=b.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return {x,y,w:r.width,h:r.height,hit:b.contains(hit),cover:hit?.tagName}; })()`);
      if (point.hit && point.w >= 44 && point.h >= 44) break;
      await pause(100);
    }
    if (!point.hit || point.w < 44 || point.h < 44) throw Error(`Unreachable/small target: ${label}: ${JSON.stringify(point)}`);
    await pause(80);
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
    await pause(80);
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await pause(80);
  }
  async function choose(filename) {
    const { root: document } = await send("DOM.getDocument");
    const { nodeId } = await send("DOM.querySelector", { nodeId: document.nodeId, selector: "#photo-file" });
    await send("DOM.setFileInputFiles", { nodeId, files: [path.join(directory, filename)] });
    await tap("上传照片");
    await wait("uploaded", "document.body.innerText.includes('照片已保存，尚未开始整理。')");
  }
  async function snapshot() {
    if (!dateUrl || !identityHeaders) throw Error('No organized photo captured');
    const read = async url => {
      const response = await fetch(url, { headers: identityHeaders });
      if (!response.ok) throw Error(`Photo verification failed: HTTP ${response.status}`);
      return response.json();
    };
    return { date: await read(dateUrl), history: await read(`${dateUrl}/history`) };
  }
  async function unchanged(before, label) {
    if (JSON.stringify(await snapshot()) !== JSON.stringify(before)) throw Error(`${label} changed server date/history`);
  }
  await send("Page.enable"); await send("Runtime.enable");
  // Installed before React loads, including after reload. No real speech service is called.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__voiceTest = { starts: 0, stops: 0, aborts: 0, spoken: [], cancels: 0 };
    class Recognition {
      start() { window.__voiceTest.current = this; window.__voiceTest.starts++; }
      stop() { window.__voiceTest.stops++; }
      abort() { window.__voiceTest.aborts++; }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: Recognition });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      constructor(text) { this.text = text; }
    } });
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak(utterance) { window.__voiceTest.spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate }); },
      cancel() { window.__voiceTest.cancels++; }
    } });
  ` });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Page.navigate", { url: `${origin}/static/companion/photos.html` });
  await wait("initial page", "!!document.querySelector('#photo-file') && document.querySelector('main').getAttribute('aria-busy') === 'false'");
  await choose("photo.jpg"); await tap("查看照片 1"); await tap("按时间整理");
  await tap("暂时不用");
  await wait("declined", "document.body.innerText.includes('已跳过整理')");
  await tap("按时间整理"); await tap("同意并整理");
  await wait("EXIF date", "document.body.innerText.includes('1985-06-07 08:09:10')");
  await evaluate(`(() => {const input=document.querySelector('#photo-date');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1970');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await tap("核对日期"); await tap("确认日期");
  await wait("manual year", "document.body.innerText.includes('1970（您确认的）')");
  await tap("查看修改历史"); await tap("恢复第 2 版"); await tap("确认恢复");
  await wait("restored", "document.querySelector('[aria-label=\"当前照片\"]').innerText.includes('1985-06-07 08:09:10')");
  await send("Page.reload", { ignoreCache: true });
  await wait("persisted list", `!!(${button("查看照片 1")})`);
  await tap("查看照片 1"); await tap("停止后续整理"); await tap("确认停止");
  await wait("revoked", "document.body.innerText.includes('已停止后续整理')");
  await choose("unknown.png");
  const unknownButton = await evaluate("[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith('查看照片') && b.textContent.includes('尚未整理')).getAttribute('aria-label')");
  await tap(unknownButton); await tap("按时间整理"); await tap("同意并整理");
  await wait("unknown date", "document.querySelector('[aria-label=\"当前照片\"]').innerText.includes('时间待确认')");
  const beforeVoice = await snapshot(), writesBeforeVoice = dateWrites.length;
  if (!await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='点一下，说日期').disabled && window.__voiceTest.starts === 0")) throw Error('Listening enabled before consent');
  await tap("读出当前提示");
  if (!await evaluate("window.__voiceTest.spoken.length === 1 && window.__voiceTest.spoken[0].text.includes('时间待确认') && window.__voiceTest.spoken[0].lang === 'zh-CN' && window.__voiceTest.spoken[0].rate === 0.7")) throw Error('Incorrect simulated reading');
  const cancels = await evaluate("window.__voiceTest.cancels");
  await tap("停止朗读");
  if (!await evaluate(`window.__voiceTest.cancels > ${cancels} && window.__voiceTest.spoken.length === 1`)) throw Error('Reading was not stopped');
  // Tap the full consent label, rather than the deliberately smaller checkbox.
  await tap("本次允许使用浏览器听写");
  await tap("点一下，说日期");
  await wait("listening", `!!(${button("停止听写")})`);
  if (!await evaluate("window.__voiceTest.starts === 1 && window.__voiceTest.current.lang === 'zh-CN' && window.__voiceTest.current.interimResults === false && document.querySelector('#photo-spoken-draft').disabled")) throw Error('Listening state incorrect');
  await tap("停止听写");
  await wait("finishing", "document.body.innerText.includes('正在结束听写') && window.__voiceTest.stops === 1");
  await evaluate("window.__voiceTest.current.onresult({results:[[{transcript:'一九八五年六月拍的'}]]}); window.__voiceTest.current.onend()");
  await wait("simulated transcript", "document.querySelector('#photo-spoken-draft').value === '一九八五年六月拍的' && !document.querySelector('#photo-spoken-draft').disabled");
  await unchanged(beforeVoice, 'Transcription');
  await tap("核对语音日期");
  await wait("spoken date proposal", "document.body.innerText.includes('按您说的，记录为 1985-06，可以吗？')");
  if (!await evaluate("document.querySelector('[aria-label=\"当前照片\"]').innerText.includes('时间待确认')")) throw Error("Spoken proposal changed the date before confirmation");
  await unchanged(beforeVoice, 'Proposal');
  await tap("取消");
  await unchanged(beforeVoice, 'Cancelled proposal');
  if (dateWrites.length !== writesBeforeVoice) throw Error('Date PATCH sent before confirmation');
  await tap("核对语音日期");
  await tap("确认日期");
  await wait("confirmed spoken month", "document.querySelector('[aria-label=\"当前照片\"]').innerText.includes('1985-06（您确认的）')");
  const afterVoice = await snapshot(), write = dateWrites.at(-1);
  if (dateWrites.length !== writesBeforeVoice + 1 || write.value !== '1985-06' || write.precision !== 'month'
    || write.expected_revision !== beforeVoice.date.revision || write.consent_version < 1
    || afterVoice.date.revision !== beforeVoice.date.revision + 1 || afterVoice.date.date?.value !== '1985-06'
    || afterVoice.date.date?.precision !== 'month' || afterVoice.date.source !== 'user'
    || afterVoice.history.changes.length !== beforeVoice.history.changes.length + 1) throw Error('Confirmed date/history incorrect');
  await send("Page.reload", { ignoreCache: true });
  await wait("voice date persistence", "document.body?.innerText.includes('1985-06（您确认的）')");
  await unchanged(afterVoice, 'Reload');
  await tap(unknownButton);
  const layouts = [];
  for (const [width, height, scale] of [[320, 568, "100%"], [375, 812, "200%"], [844, 390, "100%"]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await evaluate(`document.documentElement.style.fontSize=${JSON.stringify(scale)}`);
    await pause(100);
    const layout = await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,small:[...document.querySelectorAll('main button')].some(b=>b.getBoundingClientRect().height<44)})`);
    if (layout.scroll > width || layout.small) throw Error(`Layout failed: ${JSON.stringify({width,height,scale,...layout})}`);
    layouts.push({ width, height, scale });
  }
  if (errors.length || blocked.length) throw Error(`Browser errors/requests: ${JSON.stringify({errors,blocked})}`);
  console.log(JSON.stringify({ result: "passed", backend: "real local FastAPI and temporary SQLite", input: "CDP touch, file chooser, simulated speech recognition and synthesis", checks: ["upload", "decline", "consent", "EXIF organization", "year confirmation", "history restoration", "reload persistence", "revocation", "missing date stays pending", "listening requires consent", "reading and stop", "stop listening accepts final transcript", "transcription/proposal/cancel leave server date and history unchanged", "confirmation sends exactly one date PATCH and appends one revision", "spoken month persists after reload", "responsive layout"], unverified: ["real microphone permission", "speech service accuracy", "audio playback quality", "physical device and older adult usability"], layouts }, null, 2));
} catch (error) { console.error(error.stack || String(error)); process.exitCode = 1; }
finally {
  if (socket) socket.terminate();
  for (const child of [chrome, backend]) {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM"); await Promise.race([exited, pause(2000)]);
      if (child.exitCode === null) { child.kill("SIGKILL"); await exited; }
    }
  }
  if (directory) await rm(directory, { recursive: true, force: true });
}
