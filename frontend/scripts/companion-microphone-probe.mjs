#!/usr/bin/env node
// Real browser media APIs and native recognition. Input is exclusively a supplied synthetic WAV.
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { mediaEvidence } from "../../scripts/companion_eval/media_evidence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const arg = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (!arg("--wav") || !arg("--output")) throw new Error("Use --wav synthetic.wav --output NEW_DIRECTORY [--expect-command content|stop|save]");
const wav = path.resolve(arg("--wav")), output = path.resolve(arg("--output"));
const expectedCommand = arg("--expect-command") || "content";
const fixtureSandboxDisabled = args.includes("--fixture-no-sandbox");
if (!["content", "stop", "save"].includes(expectedCommand)) throw new Error("Invalid expected command");
if (!existsSync(wav)) throw new Error("Synthetic WAV is missing");
await mkdir(output, { recursive: false });
const report = { scope: "Real Chrome virtual microphone; native diary recognition and separate SenseVoice probe", physical_microphone: "NOT_TESTED",
  fixture_browser_sandbox_disabled: fixtureSandboxDisabled,
  expected_command: expectedCommand, fixture_sha256: createHash("sha256").update(await readFile(wav)).digest("hex"),
  fixture_looping: false,
  source_sha256: Object.fromEntries(await Promise.all([
    "scripts/companion_eval/microphone-probe.tsx", "scripts/companion_eval/media_evidence.mjs", "frontend/scripts/companion-microphone-probe.mjs",
    "frontend/src/components/companion/agent/DiaryEditor.tsx", "frontend/src/components/companion/agent/useDiaryDictation.ts",
    "frontend/src/components/companion/agent/diaryVoiceCommand.ts",
  ].map(async name => [name, createHash("sha256").update(await readFile(path.join(root, name))).digest("hex")]))),
  started_at: new Date().toISOString(), captures: [], native: null, errors: [] };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, chrome, socket, profile;
try {
  const bundle = await build({ entryPoints: [path.join(root, "scripts/companion_eval/microphone-probe.tsx")], bundle: true, write: false,
    format: "iife", platform: "browser", jsx: "automatic", nodePaths: [path.join(root, "frontend/node_modules")], define: { "process.env.NODE_ENV": '"production"' } });
  server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><div id="root"></div><script src="/probe.js"></script></html>');
    }
    if (req.method === "GET" && req.url === "/probe.js") {
      res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].contents);
    }
    if (req.method === "POST" && req.url === "/analyze") {
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const upstream = await fetch("https://garage.uniart.fun/companion-demo/sensevoice-test/analyze", {
          method: "POST", headers: { "Content-Type": req.headers["content-type"] }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(25000) });
        res.writeHead(upstream.status, { "Content-Type": "application/json" }); res.end(await upstream.text());
      } catch (error) { res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error.name })); }
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(path.join(os.tmpdir(), "companion-real-mic-"));
  const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  chrome = spawn(chromePath, ["--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", "--enable-logging=stderr",
    ...(fixtureSandboxDisabled ? ["--no-sandbox"] : []),
    `--user-data-dir=${profile}`, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}%noloop`, "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeLog = ""; chrome.stderr.on("data", data => { chromeLog = (chromeLog + data.toString()).slice(-16000); });
  let launchError; chrome.on("error", e => { launchError = e; });
  let port;
  for (let i = 0; i < 150; i++) {
    if (launchError) throw launchError;
    try { port = Number((await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); if (port) break; } catch {}
    if (chrome.exitCode !== null) throw new Error("Chrome exited before debugging became available");
    await delay(100);
  }
  if (!port) throw new Error("Chrome debugging timed out");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  let next = 0; const pending = new Map(); const exceptions = [];
  socket.on("message", data => {
    const message = JSON.parse(data.toString());
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (!pending.has(message.id)) return;
    const p = pending.get(message.id); clearTimeout(p.timeout); pending.delete(message.id);
    message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next, timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "Page evaluation failed");
    return result.result?.value;
  };
  const click = async text => {
    const point = await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled); if(!b)return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    if (!point) throw new Error(`Unavailable button: ${text}`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
  };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url: origin });
  for (let i = 0; i < 100; i++) { if (await evaluate("!!window.probe?.ready && !!document.querySelector('textarea')")) break; await delay(100); }
  report.browser = await evaluate("navigator.userAgent");
  // Three independent acquisitions exercise release/reopen without stubbing getUserMedia.
  for (let i = 0; i < 3; i++) {
    report.captures.push(await evaluate("window.probe.capture(6500)"));
    await writeFile(path.join(output, "partial.json"), JSON.stringify(report, null, 2));
    console.error(`Capture ${i + 1}/3: HTTP ${report.captures[i].http_status ?? "none"}, RMS ${report.captures[i].rms}`);
  }
  await click("开始或继续语音记录"); await click("同意并开始记录");
  await delay(15000);
  report.native = await evaluate(`({available:window.probe.nativeRecognitionAvailable,events:window.probe.events,
    text:document.querySelector('textarea').value,status:document.querySelector('[role=status]')?.textContent,
    save_confirmation:!!document.querySelector('[aria-label="日记保存确认"]'),saves:window.probe.saves})`);
  report.cleanup = await evaluate("window.probe.unmount()");
  const eventsBefore = report.cleanup.events; await delay(1000);
  report.cleanup.late_events_after_unmount = await evaluate(`window.probe.events.length-${eventsBefore}`);
  report.cleanup.events_after_unmount = await evaluate(`window.probe.events.slice(${eventsBefore})`);
  report.runtime_exceptions = exceptions;
  Object.assign(report, mediaEvidence(report));
  await writeFile(path.join(output, "chrome.log"), chromeLog);
} catch (error) { report.errors.push({ type: error.name, message: error.message }); process.exitCode = 1; }
finally {
  if (socket) socket.terminate();
  if (chrome && chrome.exitCode === null) { const end = new Promise(resolve => chrome.once("exit", resolve)); chrome.kill("SIGTERM"); await Promise.race([end, delay(3000)]); if (chrome.exitCode === null) chrome.kill("SIGKILL"); }
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (profile) {
    try { await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { report.errors.push({ type: "profile_cleanup", message: error.code }); }
  }
  report.finished_at = new Date().toISOString();
  await writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (!report.capture_checks_ok || !report.separate_sensevoice_checks_ok || !report.native_recognition_has_result) process.exitCode = 2;
}
