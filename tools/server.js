#!/usr/bin/env node
/**
 * TigerTag playground dev server.
 *
 * Serves static files from the project root AND handles:
 *   POST /api/diff   — runs TigerTag.diffApi() server-side via the JS SDK
 *
 * Usage:
 *   node tools/server.js [port]   (default port: 7432)
 *
 * Then open: http://localhost:7432/tools/playground.html
 */

'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2] || '7432', 10);

const { TigerTag } = require(path.join(PROJECT_ROOT, 'src', 'index'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.bin':  'application/octet-stream',
  '.ico':  'image/x-icon',
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

async function handleDiff(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { uid: uidHex, payload: payloadHex } = JSON.parse(body);

      if (!payloadHex) throw new Error("'payload' field is required");

      const payloadBuf = Buffer.from(payloadHex, 'hex');
      const uid        = uidHex ? Buffer.from(uidHex, 'hex') : undefined;

      const tag = TigerTag.fromPages(payloadBuf, uid);

      let apiData  = null;
      let apiError = null;
      try {
        apiData = await tag.rawApi();
      } catch (e) {
        apiError = e.message;
      }

      let diffs = [];
      if (apiData) {
        const diffList = await tag.diffApi(apiData);
        diffs = diffList.map(d => ({
          field:      d.field,
          chip_value: d.chipValue,
          api_value:  d.apiValue,
        }));
      }

      json(res, 200, {
        api_data: apiData,
        diffs,
        in_sync:  apiData !== null && diffs.length === 0,
        error:    apiError,
      });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
}

function serveFile(req, res) {
  // Sanitize path to prevent directory traversal
  const urlPath = req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(PROJECT_ROOT, safePath);

  // Default to playground.html
  if (urlPath === '/' || urlPath === '') {
    filePath = path.join(PROJECT_ROOT, 'tools', 'playground.html');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type':   mime,
      'Content-Length': stat.size,
      'Cache-Control':  'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    cors(res);
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/diff') {
    handleDiff(req, res);
    return;
  }

  serveFile(req, res);
});

server.listen(PORT, () => {
  console.log(`TigerTag playground → http://localhost:${PORT}/tools/playground.html`);
  console.log('Press Ctrl+C to stop.\n');
});
