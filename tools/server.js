#!/usr/bin/env node
/**
 * TigerTag playground dev server (JavaScript SDK).
 *
 * Implements the playground server contract shared with the Python SDK
 * (docs/playground-api.md) — the same tools/playground.html runs against either:
 *
 *   GET  /api/version            — { version, sdk, label, repo, install, style }
 *   POST /api/parse              — { uid?, payload } → pretty, describe, verify, raw_dict, dict, validate, tag_*
 *   POST /api/build              — TigerTag.create() fields (snake_case) → { payload, validate, tag_* }
 *   POST /api/diff               — { uid?, payload } → rawApi() + diffApi()
 *   GET  /api/catalog/info       — catalogue copy in use (bundled / downloaded)
 *   GET  /api/catalog/<id>       — TigerTag+ from the official catalogue
 *   POST /api/catalog/refresh    — check for a new catalogue now
 *   GET  /api/db/info            — where every reference table comes from
 *   POST /api/db/update          — { force?, catalog? } → check for new tables now
 *   GET  /api/db/table/<file>    — the reference table in use (e.g. id_material.json)
 *   GET  /api/nfc/events         — Server-Sent Events: readers:status, reader:connected,
 *                                  reader:disconnected, card:detected, card:removed, error
 *                                  (chips already on the readers are replayed on connect)
 *   POST /api/nfc/read           — { reqId?, reader? } → { messages: [read:result…, read:done] }
 *   POST /api/nfc/burn           — { reqId?, reader?, payload } → { messages: [burn:result…, burn:done] }
 *                                  pages 0x04–0x27; signature pages 0x18–0x27 always written as 00
 *   POST /api/nfc/plan           — { payload } → the APDUs a burn would send (no reader touched)
 *
 * The WebSocket transport (ws://) is kept for backward compatibility
 * (read:request / burn:write messages); the playground page uses SSE + HTTP.
 *
 * Optional dependencies (install to enable NFC reader support):
 *   npm install ws nfc-pcsc
 * TIGERTAG_PLAYGROUND_NO_NFC=1 starts the server without touching the readers (tests).
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

const {
  TigerTag, TigerTagDB, loadCatalog, refreshCatalog, catalogInfo,
} = require(path.join(PROJECT_ROOT, 'src', 'index'));
const PKG = require(path.join(PROJECT_ROOT, 'package.json'));
const { selectBurnTargets } = require('./burn_targets');
const { buildBurnPlan }     = require('./burn_plan');

const NFC_INSTALL_HINT = 'npm install ws nfc-pcsc';

// Optional: ws for the legacy WebSocket transport
let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); } catch { /* no WebSocket */ }

// Optional: nfc-pcsc for ACR122U / PN532 reader support
let NFC = null;
if (!/^(1|true|yes)$/i.test(process.env.TIGERTAG_PLAYGROUND_NO_NFC || '')) {
  try { ({ NFC } = require('nfc-pcsc')); } catch { /* no NFC reader */ }
}

// ── Version / SDK identity (the page adapts names and code to it) ─────────────

const SDK_INFO = {
  version: PKG.version,
  sdk:     'javascript',
  label:   'JS SDK',
  repo:    'https://github.com/TigerTag-Project/TigerTag-SDK-JS',
  install: 'npm install tigertag',
  server:  'node tools/server.js',
  style:   'camel',
};

// ── Shared state ──────────────────────────────────────────────────────────────

const wsClients     = new Set();   // legacy WebSocket clients
const sseClients    = new Set();   // Server-Sent Events responses
const readers       = new Map();   // readerName → { id, name, connected, hasCard, uid }
const readerObjects = new Map();   // readerName → nfc-pcsc reader (has .read() / .write())
const lastCards     = new Map();   // readerName → last card:detected (replayed on connect)

function readersStatus() {
  return {
    type:    'readers:status',
    readers: [...readers.values()],
    nfc:     NFC !== null,
    hint:    NFC ? null : NFC_INSTALL_HINT,
    error:   null,
  };
}

function sseSend(res, msg) {
  try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch { /* client gone */ }
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(data);
  }
  for (const res of sseClients) sseSend(res, msg);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const toCamel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error(`Invalid JSON body: ${e.message}`)); }
    });
    req.on('error', reject);
  });
}

let _db = null;
function getDb() {
  if (!_db) _db = new TigerTagDB();
  return _db;
}

// SDK outputs for a parsed tag (same keys as the Python server)
function describeTag(tag, db = getDb()) {
  const sig = tag.verify(db);
  return {
    pretty:    tag.pretty(db, sig),
    describe:  tag.describe(db),
    verify:    sig.toDict(),
    raw_dict:  tag.toRawDict(),
    dict:      tag.toDict(db),
    validate:  tag.validate(),
    tag_info:  tag.tagInfo,
    tag_count: tag.tagCount || null,
    tag_index: tag.tagIndex || null,
  };
}

function tagFrom(uidHex, payloadHex) {
  if (!payloadHex) throw new Error("'payload' field is required (hex, 80, 144 or 180 bytes)");
  const payload = Buffer.from(String(payloadHex).trim(), 'hex');
  const uid = uidHex ? Buffer.from(String(uidHex).trim(), 'hex') : null;
  return uid && uid.length ? TigerTag.fromPages(uid, payload) : TigerTag.fromDump(payload);
}

// TigerTag.create() keyword arguments (snake_case) → TigerTag
function buildFromFields(fields) {
  const kwargs = {};
  let available = null;
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'uid') { if (v) kwargs.uid = Buffer.from(String(v), 'hex'); continue; }
    if (k === 'measure_available') { available = v; continue; }
    kwargs[toCamel(k)] = v;
  }
  if (available != null) kwargs.measureAvailable = available;
  return TigerTag.create(kwargs);
}

// The create() fields of a tag, snake_case (same keys as the Python catalogue fields)
function createFields(tag) {
  return {
    product_id: tag.idProduct, id_material: tag.idMaterial, id_aspect_1: tag.idAspect1,
    id_aspect_2: tag.idAspect2, id_type: tag.idType, id_diameter: tag.idDiameter, id_brand: tag.idBrand,
    color1_r: tag.color1R, color1_g: tag.color1G, color1_b: tag.color1B, color1_a: tag.color1A,
    measure: tag.measure, id_unit: tag.idUnit,
    nozzle_temp_min: tag.nozzleTempMin, nozzle_temp_max: tag.nozzleTempMax,
    dry_temp: tag.dryTemp, dry_time: tag.dryTime, bed_temp_min: tag.bedTempMin, bed_temp_max: tag.bedTempMax,
    color2_r: tag.color2R, color2_g: tag.color2G, color2_b: tag.color2B,
    color3_r: tag.color3R, color3_g: tag.color3G, color3_b: tag.color3B,
  };
}

// catalogInfo() → contract shape (snake_case)
function catalogStatus() {
  const i = catalogInfo();
  return {
    downloaded:    i.downloaded,
    source:        i.source,
    count:         i.count,
    fetched_at:    i.fetchedAt,
    checked_at:    i.checkedAt,
    url:           i.url,
    etag:          i.etag,
    last_modified: i.lastModified,
    path:          i.source === 'bundled' && i.bundled ? i.bundled.file : i.cacheFile,
    bundled:       i.bundled ? { path: i.bundled.file, date: i.bundled.fetchedAt } : null,
  };
}

// TigerTagDB.info() → contract shape (snake_case, tables keyed by file name)
function dbStatus(db) {
  const i = db.info();
  const tables = {};
  for (const t of Object.values(i.tables)) {
    tables[t.file] = { source: t.source, path: t.path, timestamp: t.timestamp };
  }
  return {
    custom:      !!i.customDir,
    db_path:     i.customDir,
    data_dir:    i.dataDir,
    offline:     i.offline,
    auto_update: i.autoUpdate,
    max_age:     Math.round(i.maxAge / 1000),
    last_check:  i.lastCheck,
    last_error:  i.lastError,
    tables,
    catalog:     catalogStatus(),
  };
}

// ── NFC: read / burn one reader ───────────────────────────────────────────────

async function readChip(reader) {
  try   { return await reader.read(4, 144, 4); }
  catch { return reader.read(4, 80, 4); }
}

async function nfcRead(filter, reqId) {
  const messages = [];
  for (const [name, info] of selectBurnTargets(readers, filter)) {
    const reader = readerObjects.get(name);
    if (!reader) continue;
    const ref = { id: name, name };
    try {
      const payload = await readChip(reader);
      messages.push({ type: 'read:result', reqId, reader: ref, uid: info.uid || null,
        payload: payload.toString('hex'), bytes: payload.length, ok: true });
      console.log(`[NFC] Read OK on ${name} — UID: ${info.uid} — ${payload.length} bytes`);
    } catch (err) {
      messages.push({ type: 'read:result', reqId, reader: ref, uid: info.uid || null, ok: false, error: err.message });
      console.error(`[NFC] Read error on ${name}:`, err.message);
    }
  }
  messages.push({ type: 'read:done', reqId });
  return messages;
}

// Page plan: always pages 0x04–0x27 — the tag data, then the signature pages 0x18–0x27
// ALWAYS written as 00 (a playground never writes a signature, and a burn never leaves
// a stale one). Pages 0–3 and 0x28+ are never touched.
async function nfcBurn(filter, reqId, payloadHex) {
  const plan = buildBurnPlan(Buffer.from(String(payloadHex || '').trim(), 'hex'));   // throws on bad length
  const messages = [];
  for (const [name, info] of selectBurnTargets(readers, filter)) {
    const reader = readerObjects.get(name);
    if (!reader) continue;
    const ref = { id: name, name };
    try {
      for (const { page, data } of plan.pages) await reader.write(page, data, 4);   // one APDU per page
      messages.push({ type: 'burn:result', reqId, reader: ref, uid: info.uid || null, ok: true,
        pagesWritten: plan.pages.length, signature_dropped: plan.signatureDropped });
      console.log(`[NFC] Burn OK on ${name} — UID: ${info.uid} — ${plan.pages.length} pages written`
        + ' (signature pages written as 00' + (plan.signatureDropped ? ' — the signature in the payload was not copied)' : ')'));
      await announceChip(name, reader, info);   // read the chip back: card:detected with what is now on it
    } catch (err) {
      messages.push({ type: 'burn:result', reqId, reader: ref, uid: info.uid || null, ok: false, error: err.message });
      console.error(`[NFC] Burn error on ${name}:`, err.message);
    }
  }
  messages.push({ type: 'burn:done', reqId });
  return messages;
}

// APDUs a burn would send: UPDATE BINARY FF D6 00 <page> 04 <4 bytes>, one per page
function nfcPlan(payloadHex) {
  const plan = buildBurnPlan(Buffer.from(String(payloadHex || '').trim(), 'hex'));
  const hex2 = (b) => b.toString(16).padStart(2, '0').toUpperCase();
  return {
    signature_dropped: plan.signatureDropped,
    pages: plan.pages.length,
    apdus: plan.pages.map(({ page, data }) => ['FF', 'D6', '00', hex2(page), '04', ...[...data].map(hex2)].join(' ')),
  };
}

// Read a chip and broadcast card:detected (on placement, and after a burn)
async function announceChip(name, reader, info) {
  try {
    const payload  = await readChip(reader);
    const detected = {
      type:    'card:detected',
      reader:  { id: name, name },
      uid:     info.uid,
      payload: payload.toString('hex'),
      ...describeTag(TigerTag.fromPages(Buffer.from(info.uid, 'hex'), payload)),
    };
    lastCards.set(name, detected);
    broadcast(detected);
  } catch (err) {
    broadcast({ type: 'error', reader: { id: name, name }, message: err.message });
    console.error(`[NFC] Read error on ${name}:`, err.message);
  }
}

// ── NFC reader integration ────────────────────────────────────────────────────

function initNFC() {
  if (!NFC) return;
  const nfc = new NFC();

  nfc.on('reader', (reader) => {
    const info = { id: reader.name, name: reader.name, connected: true, hasCard: false, uid: null };
    readers.set(reader.name, info);
    readerObjects.set(reader.name, reader);
    broadcast({ type: 'reader:connected', reader: info });
    console.log(`[NFC] Reader connected: ${reader.name}`);

    reader.on('card', async (card) => {
      info.hasCard = true;
      // nfc-pcsc exposes the UID as hex; fall back to ATR bytes 5–11 (NTAG layout)
      let uid;
      if (card.uid) uid = Buffer.from(card.uid, 'hex');
      else if (card.atr && card.atr.length >= 12) uid = card.atr.slice(5, 12);
      else uid = Buffer.alloc(7);
      info.uid = uid.toString('hex').toUpperCase();
      await announceChip(reader.name, reader, info);
      console.log(`[NFC] Card on ${reader.name} — UID: ${info.uid}`);
    });

    reader.on('card.off', () => {
      info.hasCard = false;
      info.uid     = null;
      lastCards.delete(reader.name);
      broadcast({ type: 'card:removed', reader: { id: reader.name, name: reader.name } });
      console.log(`[NFC] Card removed from ${reader.name}`);
    });

    reader.on('error', (err) => {
      broadcast({ type: 'error', reader: { id: reader.name, name: reader.name }, message: err.message });
    });

    reader.on('end', () => {
      readers.delete(reader.name);
      readerObjects.delete(reader.name);
      lastCards.delete(reader.name);
      broadcast({ type: 'reader:disconnected', reader: { id: reader.name, name: reader.name } });
      console.log(`[NFC] Reader disconnected: ${reader.name}`);
    });
  });

  nfc.on('error', (err) => {
    if (err.message && err.message.includes('SCARD_E_NO_SERVICE')) return;   // PC/SC not running
    console.error('[NFC]', err.message);
  });

  console.log('[NFC] Listening for ACR122U / PC-SC readers…');
}

// ── API handlers ──────────────────────────────────────────────────────────────

const ROUTES = {
  'GET /api/version': (req, res) => json(res, 200, SDK_INFO),

  'POST /api/parse': async (req, res) => {
    try {
      const body = await readBody(req);
      json(res, 200, describeTag(tagFrom(body.uid, body.payload)));
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/build': async (req, res) => {
    try {
      const tag = buildFromFields(await readBody(req));
      json(res, 200, {
        payload: tag.toBytes(false).toString('hex'),
        validate: tag.validate(), tag_info: tag.tagInfo, tag_count: tag.tagCount || null, tag_index: tag.tagIndex || null,
      });
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/diff': async (req, res) => {
    try {
      const body = await readBody(req);
      const tag  = tagFrom(body.uid, body.payload);
      let apiData = null;
      let apiError = null;
      try { apiData = await tag.rawApi(); } catch (e) { apiError = e.message; }
      const diffs = apiData ? (await tag.diffApi(apiData)).map((d) => ({
        field: d.field, chip_value: d.chipValue, api_value: d.apiValue,
      })) : [];
      json(res, 200, { api_data: apiData, diffs, in_sync: apiData !== null && diffs.length === 0, error: apiError });
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'GET /api/catalog/info': (req, res) => json(res, 200, catalogStatus()),

  'POST /api/catalog/refresh': async (req, res) => {
    try {
      await refreshCatalog();
      json(res, 200, catalogStatus());
    } catch (e) { json(res, 503, { ...catalogStatus(), error: e.message }); }
  },

  'GET /api/db/info': (req, res) => {
    try { json(res, 200, dbStatus(getDb())); } catch (e) { json(res, 500, { error: e.message }); }
  },

  'POST /api/db/update': async (req, res) => {
    let opts = {};
    try { opts = await readBody(req); } catch { /* empty body */ }
    const db = getDb();
    try {
      const changed = await db.update({ force: !!opts.force, catalog: !!opts.catalog });
      json(res, 200, { changed, info: dbStatus(db) });
    } catch (e) { json(res, 503, { error: e.message, info: dbStatus(db) }); }
  },

  'GET /api/nfc/events': (req, res) => {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    sseSend(res, readersStatus());
    for (const detected of lastCards.values()) sseSend(res, detected);   // chips already on the readers
    sseClients.add(res);
    const keepAlive = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* gone */ } }, 15000);
    req.on('close', () => { clearInterval(keepAlive); sseClients.delete(res); });
  },

  'POST /api/nfc/read': async (req, res) => {
    try {
      const body = await readBody(req);
      json(res, 200, { messages: await nfcRead(body.reader, body.reqId ?? null) });
    } catch (e) { json(res, 400, { error: e.message }); }
  },

  'POST /api/nfc/burn': async (req, res) => {
    let body;
    try { body = await readBody(req); buildBurnPlan(Buffer.from(String(body.payload || '').trim(), 'hex')); }
    catch (e) { json(res, 400, { error: e.message }); return; }
    json(res, 200, { messages: await nfcBurn(body.reader, body.reqId ?? null, body.payload) });
  },

  'POST /api/nfc/plan': async (req, res) => {
    try {
      const body = await readBody(req);
      json(res, 200, nfcPlan(body.payload));
    } catch (e) { json(res, 400, { error: e.message }); }
  },
};

function handleDbTable(req, res, file) {
  const status = dbStatus(getDb());
  const t = status.tables[file];
  if (!t) {
    json(res, 404, { error: `Unknown table '${file}'. Known: ${Object.keys(status.tables).join(', ')}` });
    return;
  }
  fs.readFile(t.path, (err, body) => {
    if (err) { json(res, 500, { error: err.message }); return; }
    res.writeHead(200, {
      'Content-Type': 'application/json', 'Content-Length': body.length, 'Cache-Control': 'no-cache',
      'X-TigerTag-Source': t.source, 'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  });
}

async function handleCatalogProduct(req, res, idText) {
  const productId = Number(idText);
  if (!/^\d+$/.test(idText) || productId <= 0 || productId > 0xFFFFFFFE) {
    json(res, 400, { error: `Product ID must be a number (got '${idText}').` });
    return;
  }
  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    json(res, 503, { error: e.message });
    return;
  }
  const entry = catalog.get(productId);
  if (!entry) {
    json(res, 404, { error: `Product ID ${productId} is not in the TigerTag catalogue (${catalog.size} products).` });
    return;
  }
  try {
    const db  = getDb();
    const tag = TigerTag.fromCatalogEntry(entry, { db });
    const meta = {};
    for (const k of ['id', 'title', 'brand', 'sku', 'barcode', 'img_src', 'material', 'measure', 'product_type', 'color', 'color_info']) {
      meta[k] = entry[k] ?? null;
    }
    json(res, 200, {
      entry:     meta,
      rfid_data: entry.RFID_Data,
      fields:    createFields(tag),
      raw_dict:  tag.toRawDict(),
      payload:   tag.toBytes(false).toString('hex'),
      pretty:    tag.pretty(db),
      describe:  tag.describe(db),
      catalog:   catalogStatus(),
    });
  } catch (e) { json(res, 422, { error: e.message }); }
}

// ── Static file serving ───────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bin':  'application/octet-stream',
  '.ico':  'image/x-icon',
  '.md':   'text/markdown; charset=utf-8',
};

function serveFile(req, res) {
  const urlPath  = decodeURIComponent(req.url.split('?')[0]);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath   = path.join(PROJECT_ROOT, safePath);
  if (urlPath === '/' || urlPath === '') filePath = path.join(PROJECT_ROOT, 'tools', 'playground.html');
  if (!filePath.startsWith(PROJECT_ROOT)) { res.writeHead(403); res.end(); return; }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(200); res.end(); return; }
  const url = req.url.split('?')[0];
  const route = ROUTES[`${req.method} ${url}`];
  if (route) { route(req, res); return; }
  if (req.method === 'GET' && url.startsWith('/api/db/table/')) {
    handleDbTable(req, res, decodeURIComponent(url.slice('/api/db/table/'.length)));
    return;
  }
  if (req.method === 'GET' && url.startsWith('/api/catalog/')) {
    handleCatalogProduct(req, res, decodeURIComponent(url.slice('/api/catalog/'.length)));
    return;
  }
  if (url.startsWith('/api/')) { json(res, 404, { error: `Unknown endpoint: ${req.method} ${url}` }); return; }
  serveFile(req, res);
});

// ── Legacy WebSocket transport (read:request / burn:write) ────────────────────

if (WebSocketServer) {
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.send(JSON.stringify(readersStatus()));
    for (const detected of lastCards.values()) ws.send(JSON.stringify(detected));
    ws.on('close', () => wsClients.delete(ws));
    ws.on('error', () => wsClients.delete(ws));
    ws.on('message', async (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      let out = [];
      if (msg.type === 'read:request') {
        out = await nfcRead(msg.reader, msg.reqId);
      } else if (msg.type === 'burn:write') {
        try {
          out = await nfcBurn(msg.reader, msg.reqId, msg.payload);
        } catch (err) {
          out = [...selectBurnTargets(readers, msg.reader)].map(([name, info]) => ({
            type: 'burn:result', reqId: msg.reqId, reader: { id: name, name }, uid: info.uid || null,
            ok: false, error: err.message,
          }));
          out.push({ type: 'burn:done', reqId: msg.reqId });
        }
      }
      for (const m of out) ws.send(JSON.stringify(m));
    });
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\nTigerTag playground (${SDK_INFO.label} ${SDK_INFO.version}) → http://localhost:${PORT}/tools/playground.html`);
  console.log(WebSocketServer ? `[WS]  Legacy WebSocket on ws://localhost:${PORT}` : '[WS]  Legacy WebSocket not available (npm install ws)');
  console.log(NFC ? '[NFC] nfc-pcsc loaded — plug in your ACR122U' : `[NFC] Not available — run: ${NFC_INSTALL_HINT}`);
  console.log('\nPress Ctrl+C to stop.\n');
  initNFC();
});
