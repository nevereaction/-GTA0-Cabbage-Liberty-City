import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const preferredPort = Number(process.env.PORT) || 18080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.bin']);
const gzipCache = new Map();

const server = http.createServer((req, res) => {
  const rawUrl = (req.url || '/').split('?')[0];
  let urlPath;
  try {
    urlPath = decodeURIComponent(rawUrl);
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relPath);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    };
    const acceptEnc = req.headers['accept-encoding'] || '';
    if (COMPRESSIBLE.has(ext) && acceptEnc.includes('gzip') && data.length > 512) {
      let gz = gzipCache.get(filePath);
      if (!gz) {
        gz = zlib.gzipSync(data, { level: 6 });
        gzipCache.set(filePath, gz);
      }
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      res.end(gz);
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

function openBrowser(url) {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`端口 ${preferredPort} 已被占用，正在自动分配空闲端口...`);
    server.listen(0, '127.0.0.1');
  } else {
    console.error('服务器启动失败:', err);
    process.exit(1);
  }
});

server.on('listening', () => {
  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}/`;
  console.log('========================================================');
  console.log('  🥬 卷心菜自由城 · Formal Edition 1.01 (卷心菜精心制作)');
  console.log(`  🌐 本地服务已启动: ${url}`);
  console.log('  💡 保持此窗口打开即可游玩，关闭窗口将停止服务。');
  console.log('========================================================');
  if (!process.env.NO_OPEN) openBrowser(url);
});

server.listen(preferredPort, '127.0.0.1');
