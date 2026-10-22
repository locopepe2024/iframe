#!/usr/bin/env node
// Real local API + exported webpage. Uses temporary synthetic images and DB.
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
  const button = label => `[...document.querySelectorAll('button')].find(b => (b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}) && !b.disabled)`;
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
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  async function choose(filename) {
    const { root: document } = await send("DOM.getDocument");
    const { nodeId } = await send("DOM.querySelector", { nodeId: document.nodeId, selector: "#photo-file" });
    await send("DOM.setFileInputFiles", { nodeId, files: [path.join(directory, filename)] });
    await tap("上传照片");
    await wait("uploaded", "document.body.innerText.includes('照片已保存，尚未开始整理。')");
  }
  await send("Page.enable"); await send("Runtime.enable");
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
  console.log(JSON.stringify({ result: "passed", backend: "real local FastAPI and temporary SQLite", input: "CDP touch, file chooser", checks: ["upload", "decline", "consent", "EXIF organization", "year confirmation", "history restoration", "reload persistence", "revocation", "missing date stays pending", "responsive layout"], layouts }, null, 2));
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
