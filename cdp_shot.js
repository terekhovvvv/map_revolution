// cdp_shot.js — скриншот рабочего экрана УТС БЕРЕСТА безголовым Edge:
// открывает страницу, «прокликивает» меню и справку, снимает рабочую область.
// Запуск: node cdp_shot.js <outfile.png>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = process.argv[2] || 'workspace_shot.png';
const PORT = 9223;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL_APP = 'http://localhost:7100/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-cdp-'));
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--window-size=1600,900',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    // ждём поднятия CDP-порта
    let targets = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
        targets = await r.json();
        if (targets.length) break;
      } catch { /* ещё не поднялся */ }
    }
    if (!targets || !targets.length) throw new Error('CDP не поднялся');
    const page = targets.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else if (m.method) events.push(m.method);
    };
    const send = (method, params = {}) => new Promise(res => {
      const mid = ++id; pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

    await send('Page.enable');
    await send('Page.navigate', { url: URL_APP });
    for (let i = 0; i < 40 && !events.includes('Page.loadEventFired'); i++) await sleep(250);
    await sleep(1500); // догрузка карты и шрифтов

    // «Приступить к работе» → справка → «Продолжить» → рабочая область
    await send('Runtime.evaluate', { expression: "document.getElementById('btnStart').click()" });
    await sleep(500);
    await send('Runtime.evaluate', { expression: "document.getElementById('btnHelpClose').click()" });
    await sleep(800);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log('скриншот сохранён:', OUT);
    ws.close();
  } finally {
    edge.kill();
    await sleep(1000); // даём Edge завершиться, чтобы отпустить файлы профиля
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; }
      catch { await sleep(500); }
    }
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
