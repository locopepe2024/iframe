#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exportRoot = path.resolve(frontendRoot, "../static");
const pagePath = "/static/companion/copilot-trial.html";
const fontHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"], [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".png", "image/png"],
  [".svg", "image/svg+xml"], [".txt", "text/plain; charset=utf-8"],
  [".woff", "font/woff"], [".woff2", "font/woff2"],
]);

function findChrome() {
  const configured = process.env.CHROME_BIN || process.env.CHROME_PATH;
  if (configured && existsSync(configured)) return configured;
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"]
    : process.platform === "win32"
      ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const installed = candidates.find(candidate => existsSync(candidate));
  if (installed) return installed;
  const commands = process.platform === "win32" ? ["chrome.exe"] : ["google-chrome", "chromium", "chromium-browser"];
  for (const command of commands) {
    const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], { encoding: "utf8" });
    const found = result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
    if (found && existsSync(found)) return found;
  }
  throw new Error("Chrome/Chromium not found. Set CHROME_BIN to its executable path.");
}

function isAllowedUrl(value, localOrigin) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.origin === localOrigin) {
    return url.pathname === "/favicon.ico" || url.pathname === "/static" || url.pathname.startsWith("/static/");
  }
  if (url.protocol === "data:" || url.protocol === "blob:") return true;
  return url.protocol === "https:" && fontHosts.has(url.hostname);
}

function createStaticServer() {
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405).end();
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname); }
    catch { response.writeHead(400).end(); return; }
    const relative = pathname === "/favicon.ico" ? "favicon.ico"
      : pathname.startsWith("/static/") ? pathname.slice("/static/".length)
        : pathname === "/static" ? "index.html" : null;
    if (!relative) { response.writeHead(404).end(); return; }
    const file = path.resolve(exportRoot, relative);
    if (file !== exportRoot && !file.startsWith(`${exportRoot}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": mimeTypes.get(path.extname(file)) || "application/octet-stream", "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return server;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
let chrome;
let chromeLaunchError;
let socket;
let profileDir;

try {
  if (!existsSync(path.join(exportRoot, pagePath.slice("/static/".length)))) {
    throw new Error(`Static page not found: ${path.join(exportRoot, pagePath.slice("/static/".length))}. Run npm run build first.`);
  }
  const chromePath = findChrome();
  server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine local test server port.");
  const localOrigin = `http://127.0.0.1:${address.port}`;

  profileDir = await mkdtemp(path.join(os.tmpdir(), "iframe-companion-browser-smoke-"));
  chrome = spawn(chromePath, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
    "--disable-component-update", "--disable-default-apps", "--disable-sync", "--metrics-recording-only",
    "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "about:blank",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ], { stdio: "ignore" });
  chrome.once("error", error => { chromeLaunchError = error; });

  let debugPort;
  const activePortFile = path.join(profileDir, "DevToolsActivePort");
  const debugDeadline = Date.now() + 15000;
  while (Date.now() < debugDeadline) {
    try {
      const lines = (await readFile(activePortFile, "utf8")).trim().split(/\r?\n/);
      debugPort = Number(lines[0]);
      if (debugPort > 0) break;
    } catch { /* Chrome is still starting. */ }
    if (chromeLaunchError) throw chromeLaunchError;
    if (chrome.exitCode !== null) throw new Error(`Chrome exited before DevTools started (code ${chrome.exitCode}).`);
    await delay(100);
  }
  if (!debugPort) throw new Error("Timed out waiting for Chrome DevTools.");
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const pageTarget = targets.find(target => target.type === "page");
  if (!pageTarget) throw new Error("Chrome did not expose a page target.");

  socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const requests = new Set();
  const unexpectedRequests = new Set();
  const runtimeExceptions = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(typeof event.data === "string" ? event.data : event.data.toString());
    if (message.method === "Network.requestWillBeSent") requests.add(message.params.request.url);
    if (message.method === "Runtime.exceptionThrown") runtimeExceptions.push(message.params.exceptionDetails.text || "Browser runtime exception");
    if (message.method === "Fetch.requestPaused") {
      const requestUrl = message.params.request.url;
      requests.add(requestUrl);
      const method = isAllowedUrl(requestUrl, localOrigin) ? "Fetch.continueRequest" : "Fetch.failRequest";
      if (method === "Fetch.failRequest") unexpectedRequests.add(requestUrl);
      void send(method, method === "Fetch.continueRequest"
        ? { requestId: message.params.requestId }
        : { requestId: message.params.requestId, errorReason: "BlockedByClient" })
        .catch(error => runtimeExceptions.push(`Request policy error: ${error.message}`));
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timeout } = pending.get(message.id);
      clearTimeout(timeout);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools.")), 10000);
    socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener("error", error => { clearTimeout(timeout); reject(error); }, { once: true });
  });
  function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools command timed out: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "Runtime evaluation failed");
    return result.result?.value;
  }
  async function waitFor(label, expression, timeout = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = await evaluate(expression);
      if (value) return value;
      await delay(100);
    }
    throw new Error(`Timed out: ${label}`);
  }
  async function clickText(label) {
    const selector = `[...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(label)} && !node.disabled)`;
    await waitFor(`enabled button: ${label}`, `!!(${selector})`);
    const exists = await evaluate(`(() => { const button = ${selector}; if (!button) return false; button.scrollIntoView({block: 'center'}); return true; })()`);
    if (!exists) throw new Error(`Button unavailable: ${label}`);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    const point = await evaluate(`(() => { const button = ${selector}; if (!button) return null; const r = button.getBoundingClientRect(); const x = r.x + r.width / 2; const y = r.y + r.height / 2; const hit = document.elementFromPoint(x, y); return {x, y, width: r.width, height: r.height, reachable: hit === button || button.contains(hit)}; })()`);
    if (!point?.reachable || point.width < 44 || point.height < 44) throw new Error(`Button is not reachable or is too small: ${label}: ${JSON.stringify(point)}`);
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  const buttonExists = label => `!![...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(label)})`;

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.navigate", { url: `${localOrigin}${pagePath}` });
  await waitFor("trial page", `!!document.querySelector('main[data-font-size]') && !!document.querySelector('button')`);
  await waitFor("ready shortcuts", `!![...document.querySelectorAll('button')].find(node => node.textContent.trim() === '字调大一点' && !node.disabled)`);

  const initial = await evaluate(`({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, font: document.querySelector('main').dataset.fontSize })`);
  if (initial.width !== 390 || initial.scrollWidth > initial.width) throw new Error(`Initial horizontal overflow: ${JSON.stringify(initial)}`);

  await clickText("字调大一点");
  await waitFor("font confirmation", buttonExists("确认调整"));
  if (await evaluate(`document.querySelector('main').dataset.fontSize`) !== "normal") throw new Error("Font changed before confirmation.");
  await clickText("取消");
  await waitFor("cancelled font card", `![...document.querySelectorAll('button')].some(node => node.textContent.trim() === '确认调整')`);
  await clickText("字调大一点");
  await waitFor("second font confirmation", buttonExists("确认调整"));
  await clickText("确认调整");
  await waitFor("large font applied", `document.querySelector('main').dataset.fontSize === 'large'`);
  const layouts = [];
  for (const { width, height, textScale } of [
    { width: 320, height: 568, textScale: "100%" },
    { width: 375, height: 812, textScale: "200%" },
    { width: 844, height: 390, textScale: "100%" },
  ]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    await evaluate(`document.documentElement.style.fontSize = ${JSON.stringify(textScale)}`);
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => resolve(true)))`);
    const layout = await evaluate(`({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, clipped: [...document.querySelectorAll('main, main div, main button, main textarea')].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.tagName), font: document.querySelector('main').dataset.fontSize })`);
    if (layout.width !== width || layout.scrollWidth > width || layout.clipped.length) throw new Error(`Large-text layout is clipped: ${JSON.stringify({width, height, textScale, ...layout})}`);
    layouts.push({ width, height, textScale, font: layout.font });
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`document.documentElement.style.fontSize = '81.25%'`);
  await clickText("恢复普通字号");
  await waitFor("restore confirmation", buttonExists("确认调整"));
  await clickText("确认调整");
  await waitFor("normal font restored", `document.querySelector('main').dataset.fontSize === 'normal'`);

  await clickText("按时间整理");
  await waitFor("time confirmation", buttonExists("同意本次整理"));
  await clickText("取消");
  await waitFor("time consent declined", `!${buttonExists("同意本次整理")} && document.body.textContent.includes('未授权，本批不整理。')`);
  if (await evaluate(`[...document.querySelectorAll('main h3')].some(heading => heading.parentElement?.textContent?.includes('模拟结果：'))`)) {
    throw new Error("Photo sample processing started after consent was declined.");
  }
  await clickText("按时间整理");
  await waitFor("second time confirmation", buttonExists("同意本次整理"));
  await clickText("同意本次整理");
  await waitFor("sample results", `['模拟结果：1980', '模拟结果：2001-05', '模拟结果：时间待确认'].every(text => document.body.textContent.includes(text))`, 12000);
  await clickText("撤回授权并清除模拟结果");
  await waitFor("sample results cleared", `![...document.querySelectorAll('main h3')].some(heading => heading.parentElement?.textContent?.includes('模拟结果：'))`);

  const final = await evaluate(`({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, font: document.querySelector('main').dataset.fontSize })`);
  if (final.scrollWidth > final.width) throw new Error(`Final horizontal overflow: ${JSON.stringify(final)}`);
  await delay(500);
  const unapproved = [...requests].filter(url => !isAllowedUrl(url, localOrigin));
  if (unapproved.length || unexpectedRequests.size) {
    throw new Error(`Unexpected non-local requests: ${[...new Set([...unapproved, ...unexpectedRequests])].join(", ")}`);
  }
  if (runtimeExceptions.length) throw new Error(`Browser runtime errors: ${runtimeExceptions.join("; ")}`);

  console.log(JSON.stringify({
    result: "passed",
    viewport: { initial, final },
    largeTextLayouts: layouts,
    input: "CDP touch events with target size and hit testing",
    checks: ["font change waits for confirmation", "cancel keeps current font", "font can be restored", "declining photo consent starts no work", "authorized photo sample completes", "withdrawal clears simulated results"],
    requestCount: requests.size,
    allowedFontRequests: [...requests].filter(url => { try { return fontHosts.has(new URL(url).hostname); } catch { return false; } }),
    blockedUnexpectedRequests: [...unexpectedRequests],
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  if (socket) socket.terminate();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
  }
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
}
