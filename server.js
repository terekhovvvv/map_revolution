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

const server = http.createServer((req, res) => {
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
  console.log(`УТС БЕРЕСТА dev-server: http://${host}:${port}/`);
});
