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
const PKG = require(path.join(PROJECT_ROOT, 'package.json'));

// Optional: ws for WebSocket support
let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); } catch { /* no WebSocket */ }

// Optional: nfc-pcsc for ACR122U / PN532 reader support
let NFC = null;
try { ({ NFC } = require('nfc-pcsc')); } catch { /* no NFC reader */ }

// ── WebSocket state ───────────────────────────────────────────────────────────

const wsClients     = new Set();
const readers       = new Map(); // readerName → { id, name, connected, hasCard }
const readerObjects = new Map(); // readerName → nfc-pcsc reader (has .write())

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
    readerObjects.set(reader.name, reader);
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
        info.uid = uid.toString('hex').toUpperCase(); // store for burn:result

        // Read pages 4–39 (144 bytes: user data + signature)
        // Fall back to 80 bytes if the chip is too small
        let payload;
        try {
          payload = await reader.read(4, 144, 4);
        } catch {
          payload = await reader.read(4, 80, 4);
        }

        const tag    = TigerTag.fromPages(uid, payload);
        const sigRes = tag.verify(db);

        broadcast({
          type:     'card:detected',
          reader:   { id: reader.name, name: reader.name },
          uid:      uid.toString('hex').toUpperCase(),
          payload:  payload.toString('hex'),
          pretty:   tag.pretty(db, sigRes),
          describe: tag.describe(db),
          verify:   sigRes.toDict(),
          raw_dict: tag.toRawDict(),
          dict:     tag.toDict(db),
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
      info.uid     = null;
      broadcast({ type: 'card:removed', reader: { id: reader.name, name: reader.name } });
      console.log(`[NFC] Card removed from ${reader.name}`);
    });

    reader.on('error', (err) => {
      broadcast({ type: 'error', reader: { id: reader.name, name: reader.name }, message: err.message });
    });

    reader.on('end', () => {
      readers.delete(reader.name);
      readerObjects.delete(reader.name);
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

// ── API: /api/parse ───────────────────────────────────────────────────────────
// Returns all SDK method outputs for a given uid + payload (hex).
// The playground uses this so the browser never reconstructs SDK data manually.

async function handleParse(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const { uid: uidHex, payload: payloadHex } = JSON.parse(body);
      if (!payloadHex) throw new Error("'payload' field is required");

      const payloadBuf = Buffer.from(payloadHex, 'hex');
      const uid        = uidHex ? Buffer.from(uidHex, 'hex') : undefined;
      const db         = new TigerTagDB();
      const tag        = TigerTag.fromPages(uid, payloadBuf);
      const sigRes     = tag.verify(db);

      json(res, 200, {
        pretty:   tag.pretty(db, sigRes),
        describe: tag.describe(db),
        verify:   sigRes.toDict(),
        raw_dict: tag.toRawDict(),
        dict:     tag.toDict(db),
      });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
}

// ── API: /api/build ───────────────────────────────────────────────────────────
// Serializes a new tag via TigerTag.create(kwargs).toBytes() and returns the
// hex payload. The playground uses this so the browser never hand-rolls the
// chip binary format — the SDK is always the authoritative serializer.

async function handleBuild(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const kwargs = JSON.parse(body);
      const tag    = TigerTag.create(kwargs);
      const bytes  = tag.toBytes(false);
      json(res, 200, { payload: bytes.toString('hex') });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });
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
      const tag        = TigerTag.fromPages(uid, payloadBuf);

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
  if (req.method === 'GET'  && req.url === '/api/version') { json(res, 200, { version: PKG.version }); return; }
  if (req.method === 'POST' && req.url === '/api/parse')   { handleParse(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/build')   { handleBuild(req, res); return; }
  if (req.method === 'POST' && req.url === '/api/diff')    { handleDiff(req, res); return; }
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

    // Handle incoming messages from the playground (burn / raw-read requests)
    ws.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // ── read:request — read 144 raw bytes from every reader with a card ──────
      if (msg.type === 'read:request') {
        const reqId = msg.reqId;
        for (const [name, info] of readers.entries()) {
          if (!info.hasCard) continue;
          const reader = readerObjects.get(name);
          if (!reader) continue;
          const cardUid = info.uid || null;
          try {
            let payload;
            try   { payload = await reader.read(4, 144, 4); }
            catch { payload = await reader.read(4, 80, 4);  }
            ws.send(JSON.stringify({
              type: 'read:result', reqId,
              reader: { id: name, name },
              uid:     cardUid,
              payload: payload.toString('hex'),
              bytes:   payload.length,
              ok:      true,
            }));
            console.log(`[NFC] Read OK on ${name} — UID: ${cardUid} — ${payload.length} bytes`);
          } catch (err) {
            ws.send(JSON.stringify({
              type: 'read:result', reqId,
              reader: { id: name, name },
              uid:     cardUid,
              ok:      false, error: err.message,
            }));
            console.error(`[NFC] Read error on ${name}:`, err.message);
          }
        }
        ws.send(JSON.stringify({ type: 'read:done', reqId }));
        return;
      }

      if (msg.type !== 'burn:write') return;

      const payloadBuf = Buffer.from(msg.payload, 'hex'); // 80 bytes (pages 4–23)
      const reqId      = msg.reqId;

      // Write sequentially to every reader that currently has a card
      for (const [name, info] of readers.entries()) {
        if (!info.hasCard) continue;
        const reader = readerObjects.get(name);
        if (!reader) continue;

        const cardUid = info.uid || null;
        try {
          // Write 20 pages × 4 bytes, one page per APDU (NTAG hardware limit)
          for (let i = 0; i < 20; i++) {
            const page = payloadBuf.slice(i * 4, i * 4 + 4);
            await reader.write(4 + i, page, 4);
          }
          ws.send(JSON.stringify({
            type: 'burn:result', reqId,
            reader: { id: name, name },
            uid: cardUid,
            ok: true, pagesWritten: 20,
          }));
          console.log(`[NFC] Burn OK on ${name} — UID: ${cardUid} — 20 pages written`);
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'burn:result', reqId,
            reader: { id: name, name },
            uid: cardUid,
            ok: false, error: err.message,
          }));
          console.error(`[NFC] Burn error on ${name}:`, err.message);
        }
      }

      // Signal that all readers have been processed for this request
      ws.send(JSON.stringify({ type: 'burn:done', reqId }));
    });
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
