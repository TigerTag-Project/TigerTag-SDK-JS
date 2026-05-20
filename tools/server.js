#!/usr/bin/env node
/**
 * TigerTag playground dev server.
 *
 * Serves static files from the project root AND handles:
 *   POST /api/diff     — runs TigerTag.diffApi() server-side via the JS SDK
 *   WebSocket (ws://)  — pushes ACR122U / PC-SC card events to the playground
 *
 * Optional dependencies (install to enable NFC reader support):
 *   npm install ws nfc-pcsc
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

const { TigerTag, TigerTagDB } = require(path.join(PROJECT_ROOT, 'src', 'index'));

// Optional: ws for WebSocket support
let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); } catch { /* no WebSocket */ }

// Optional: nfc-pcsc for ACR122U / PN532 reader support
let NFC = null;
try { ({ NFC } = require('nfc-pcsc')); } catch { /* no NFC reader */ }

// ── WebSocket state ───────────────────────────────────────────────────────────

const wsClients = new Set();
const readers   = new Map(); // readerName → { id, name, connected, hasCard }

function broadcast(msg) {
  if (!wsClients.size) return;
  const data = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(data);
  }
}

// ── NFC reader integration ────────────────────────────────────────────────────

function initNFC() {
  if (!NFC) return;

  const db  = new TigerTagDB();
  const nfc = new NFC();

  nfc.on('reader', (reader) => {
    const info = { id: reader.name, name: reader.name, connected: true, hasCard: false };
    readers.set(reader.name, info);
    broadcast({ type: 'reader:connected', reader: info });
    console.log(`[NFC] Reader connected: ${reader.name}`);

    reader.on('card', async (card) => {
      info.hasCard = true;
      try {
        // nfc-pcsc 0.8.x exposes uid as hex string on card object
        // Extract UID: prefer card.uid, fallback to card.atr bytes 5–11 (NTAG layout)
        let uid;
        if (card.uid) {
          uid = Buffer.from(card.uid, 'hex');
        } else if (card.atr && card.atr.length >= 12) {
          // ATR for NTAG: bytes 5–11 contain the 7-byte UID
          uid = card.atr.slice(5, 12);
        } else {
          uid = Buffer.alloc(7);
        }

        // Read pages 4–39 (144 bytes: user data + signature)
        // Fall back to 80 bytes if the chip is too small
        let payload;
        try {
          payload = await reader.read(4, 144, 4);
        } catch {
          payload = await reader.read(4, 80, 4);
        }

        const tag    = TigerTag.fromPages(payload, uid);
        const sigRes = tag.verify(db);

        broadcast({
          type:    'card:detected',
          reader:  { id: reader.name, name: reader.name },
          uid:     uid.toString('hex').toUpperCase(),
          payload: payload.toString('hex'),
          pretty:  tag.pretty(db),
          verify:  sigRes.toDict(),
          raw:     tag.toRawDict(),
        });

        console.log(`[NFC] Card on ${reader.name} — UID: ${uid.toString('hex').toUpperCase()}`);
      } catch (err) {
        broadcast({
          type:    'error',
          reader:  { id: reader.name, name: reader.name },
          message: err.message,
        });
        console.error(`[NFC] Read error on ${reader.name}:`, err.message);
      }
    });

    reader.on('card.off', () => {
      info.hasCard = false;
      broadcast({ type: 'card:removed', reader: { id: reader.name, name: reader.name } });
      console.log(`[NFC] Card removed from ${reader.name}`);
    });

    reader.on('error', (err) => {
      broadcast({ type: 'error', reader: { id: reader.name, name: reader.name }, message: err.message });
    });

    reader.on('end', () => {
      readers.delete(reader.name);
      broadcast({ type: 'reader:disconnected', reader: { id: reader.name, name: reader.name } });
      console.log(`[NFC] Reader disconnected: ${reader.name}`);
    });
  });

  nfc.on('error', (err) => {
    // Suppress PC/SC service not running — not fatal for the playground
    if (err.message && err.message.includes('SCARD_E_NO_SERVICE')) return;
    console.error('[NFC]', err.message);
  });

  console.log('[NFC] Listening for ACR122U / PC-SC readers…');
}

// ── MIME types ────────────────────────────────────────────────────────────────

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

// ── API: /api/diff ────────────────────────────────────────────────────────────

async function handleDiff(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { uid: uidHex, payload: payloadHex } = JSON.parse(body);
      if (!payloadHex) throw new Error("'payload' field is required");

      const payloadBuf = Buffer.from(payloadHex, 'hex');
      const uid        = uidHex ? Buffer.from(uidHex, 'hex') : undefined;
      const tag        = TigerTag.fromPages(payloadBuf, uid);

      let apiData  = null;
      let apiError = null;
      try { apiData = await tag.rawApi(); } catch (e) { apiError = e.message; }

      const diffs = apiData ? (await tag.diffApi(apiData)).map(d => ({
        field: d.field, chip_value: d.chipValue, api_value: d.apiValue,
      })) : [];

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

// ── Static file serving ───────────────────────────────────────────────────────

function serveFile(req, res) {
  const urlPath  = req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath   = path.join(PROJECT_ROOT, safePath);

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

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(200); res.end(); return; }
  if (req.method === 'POST' && req.url === '/api/diff') { handleDiff(req, res); return; }
  serveFile(req, res);
});

// ── WebSocket server (attached to same HTTP server) ───────────────────────────

if (WebSocketServer) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    wsClients.add(ws);

    // Immediately send current reader state to the new client
    ws.send(JSON.stringify({
      type:    'readers:status',
      readers: [...readers.values()],
      nfc:     NFC !== null,
    }));

    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\nTigerTag playground → http://localhost:${PORT}/tools/playground.html`);
  if (WebSocketServer) {
    console.log(`[WS]  WebSocket ready on ws://localhost:${PORT}`);
  } else {
    console.log('[WS]  Not available — run: npm install ws nfc-pcsc');
  }
  if (NFC) {
    console.log('[NFC] nfc-pcsc loaded — plug in your ACR122U');
  } else {
    console.log('[NFC] Not available — run: npm install ws nfc-pcsc');
  }
  console.log('\nPress Ctrl+C to stop.\n');

  initNFC();
});
