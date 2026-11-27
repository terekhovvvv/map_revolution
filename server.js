/**
 * Минимальный статический dev-сервер без внешних зависимостей.
 * Поддерживает аргументы: --port <n> / -p <n> / --port=<n>, --host <h> / --host=<h>
 * Это нужно, чтобы внешний раннер мог передать свой порт через CLI.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

let port = 7100;
let host = '127.0.0.1';

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port' || a === '-p') port = parseInt(args[++i], 10);
  else if (a.startsWith('--port=')) port = parseInt(a.split('=')[1], 10);
  else if (a === '--host') host = args[++i];
  else if (a.startsWith('--host=')) host = a.split('=')[1];
}
if (!Number.isFinite(port) || port <= 0) port = 7100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const ROOT = __dirname;

/** Чтение тела POST-запроса (с лимитом 2 МБ). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('слишком большое тело')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * POST /api/save-mesh — зафиксировать текущее положение сетки как базовое:
 * перезаписывает js/gridmesh.js (меш узлов, изогнутый правками пользователя).
 * Ожидает JSON {originX, originY, nodeX: number[][], nodeY: number[][]}.
 */
async function handleSaveMesh(req, res) {
  try {
    const data = JSON.parse(await readBody(req));
    const ok = Number.isInteger(data.originX) && Number.isInteger(data.originY) &&
      Array.isArray(data.nodeX) && Array.isArray(data.nodeY) &&
      data.nodeX.length === data.nodeY.length && data.nodeX.length > 1 &&
      data.nodeX.every((r, i) => Array.isArray(r) && Array.isArray(data.nodeY[i]) &&
        r.length === data.nodeX[0].length && r.length === data.nodeY[i].length &&
        r.every(Number.isFinite) && data.nodeY[i].every(Number.isFinite));
    if (!ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'некорректный меш' }));
      return;
    }
    const nx = data.nodeX.length, ny = data.nodeX[0].length;
    const fmt = m => JSON.stringify(m.map(row => row.map(v => Math.round(v * 10) / 10)));
    const content =
`/**
 * gridmesh.js — базовое положение сетки, зафиксированное пользователем
 * через «✏️ Линии» → «📌 Зафиксировать как базовую» (не править вручную;
 * перезаписывается сервером по POST /api/save-mesh).
 *   nodeX[i][j] — px-координата узла (X = originX + i, Y = originY + j),
 *   nodeY[i][j] — py-координата того же узла.
 *   Узлов: ${nx} × ${ny}. Между узлами — билинейная интерполяция (Calibration).
 */
const GRID_MESH = {"originX":${data.originX},"originY":${data.originY},"nodeX":${fmt(data.nodeX)},"nodeY":${fmt(data.nodeY)}};
`;
    fs.writeFileSync(path.join(ROOT, 'js', 'gridmesh.js'), content, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, nodes: nx * ny }));
    console.log(`gridmesh.js обновлён: ${nx}×${ny} узлов`);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}

const server = http.createServer((req, res) => {
  // API: фиксация базового положения сетки
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/save-mesh') {
    handleSaveMesh(req, res);
    return;
  }

  // Отрезаем query-string и защищаемся от выхода за пределы корня (path traversal)
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, host, () => {
  console.log(`TopoMap dev-server: http://${host}:${port}/`);
});
