/**
 * dev-server.js — Servidor local de desenvolvimento (sem dependências).
 *
 *  - Serve arquivos estáticos (index.html, script.min.js, style.min.css, assets/…).
 *  - Roteia POST /api/quiz para o handler em api/quiz.js (mesma assinatura
 *    que o Vercel: req.body já parseado como JSON).
 *  - Carrega variáveis de .env.local antes de require()ar o handler.
 *
 *  Uso:
 *    node dev-server.js            (porta 3000)
 *    PORT=4000 node dev-server.js  (porta custom)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '.env.local'));

const handler = require('./api/quiz.js');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  ico: 'image/x-icon',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

function send(res, status, body, contentType) {
  res.statusCode = status;
  if (contentType) res.setHeader('Content-Type', contentType);
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // normaliza e impede path traversal
  const safe = path.normalize(urlPath).replace(/^([/\\])+/, '');
  let filePath = path.join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'forbidden', 'text/plain');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // tenta cleanUrls (ex.: /foo -> /foo.html)
      if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
      else if (!path.extname(filePath)) filePath = filePath + '.html';
      fs.readFile(filePath, (e2, data) => {
        if (e2) return send(res, 404, 'not found', 'text/plain');
        const ext = path.extname(filePath).slice(1).toLowerCase();
        send(res, 200, data, MIME[ext] || 'application/octet-stream');
      });
      return;
    }
    fs.readFile(filePath, (e2, data) => {
      if (e2) return send(res, 500, 'read error', 'text/plain');
      const ext = path.extname(filePath).slice(1).toLowerCase();
      send(res, 200, data, MIME[ext] || 'application/octet-stream');
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] ${req.method} ${req.url}`);

  if (urlPath === '/api/quiz') {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'method_not_allowed' }));
    }
    const raw = await readBody(req);
    try { req.body = raw ? JSON.parse(raw) : {}; }
    catch { req.body = {}; }
    return handler(req, res);
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\nDev server pronto: http://localhost:${PORT}`);
  console.log(`API:                http://localhost:${PORT}/api/quiz`);
  console.log(`Env GHL configured: ${Boolean(process.env.GHL_PIT_TOKEN && process.env.GHL_LOCATION_ID)}\n`);
});
