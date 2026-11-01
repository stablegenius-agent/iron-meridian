// Headless playtest harness: launches Edge with remote debugging, loads the game, runs a scenario
// module against it via the Chrome DevTools Protocol, saves screenshots and reports console errors.
//
//   node tools/playtest.mjs tools/scenarios/smoke.mjs [--size=1600x900] [--port=8777]
//
// A scenario exports `default async function (h)` where h = { eval, shot, wait, click, key, log }.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const scenario = args.find(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
const [W, H] = (opt.size || '1600x900').split('x').map(Number);
const PORT = opt.port || '8777';
const DBG = 9333;
const OUT = join(ROOT, 'tools', 'shots');
mkdirSync(OUT, { recursive: true });

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const prof = join(process.env.TEMP || '/tmp', 'im-playtest-profile');
try { rmSync(prof, { recursive: true, force: true }); } catch {}

const edge = spawn(EDGE, [
  '--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('Edge debugging endpoint never came up');
}

const ws = new WebSocket(await target());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0;
const pending = new Map();
const problems = [];
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    problems.push(`EXCEPTION: ${d.exception?.description || d.text} @ ${d.url || ''}:${d.lineNumber}`);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error' || m.params.type === 'warning') problems.push(`console.${m.params.type}: ${text}`);
    else logs.push(text);
  } else if (m.method === 'Log.entryAdded') {
    const e = m.params.entry;
    if (e.level === 'error' && !/favicon/.test(e.text)) problems.push(`log.error: ${e.text} ${e.url || ''}`);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://localhost:${PORT}/` });

const h = {
  async eval(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n  in: ${expr.slice(0, 200)}`);
    return r.result.value;
  },
  async shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `${name}.png`);
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log(`[shot] ${file}`);
    return file;
  },
  wait: sleep,
  async click(x, y) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  },
  async key(key, code = key) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  },
  async until(expr, ms = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await h.eval(expr)) return true; await sleep(250); }
    throw new Error(`timeout waiting for: ${expr}`);
  },
  log: (...a) => console.log('[pt]', ...a),
};

let failed = false;
try {
  await h.until('!!window.__game', 30000);
  const mod = await import(pathToFileURL(resolve(scenario)).href);
  await mod.default(h);
} catch (e) {
  failed = true;
  console.log('[pt] SCENARIO ERROR:', e.message);
  try { await h.shot('error'); } catch {}
} finally {
  console.log(`\n[pt] ${problems.length} problem(s)`);
  for (const p of [...new Set(problems)].slice(0, 40)) console.log('  ' + p);
  if (opt.logs) for (const l of logs.slice(-30)) console.log('  log: ' + l);
  ws.close();
  edge.kill();
  process.exit(failed || problems.some(p => p.startsWith('EXCEPTION')) ? 1 : 0);
}
