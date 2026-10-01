'use strict';

// Playground: the shared page stays identical to the Python SDK's copy, and tools/server.js
// implements the server contract (docs/playground-api.md). The server runs without readers.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { check } = require('../scripts/check_playground_sync');

describe('tools/playground.html sync', () => {
  test('identical to the Python SDK copy (skipped when unreachable)', async () => {
    const r = await check();
    if (r.status === 'unreachable') return;   // no sibling checkout, offline
    expect(r).toMatchObject({ status: 'identical' });
  });
});

describe('playground server contract', () => {
  let proc;
  let base;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tigertag-pg-'));

  beforeAll(async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    base = `http://127.0.0.1:${port}`;
    proc = spawn(process.execPath, [path.join(__dirname, '..', 'tools', 'server.js'), String(port)], {
      env: { ...process.env, TIGERTAG_PLAYGROUND_NO_NFC: '1', TIGERTAG_OFFLINE: '1', TIGERTAG_DATA_DIR: dataDir },
      stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${base}/api/version`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    throw new Error('server did not start');
  });
  afterAll(() => { proc && proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  test('GET /api/version names the SDK', async () => {
    const v = await (await fetch(`${base}/api/version`)).json();
    expect(v).toMatchObject({ sdk: 'javascript', label: 'JS SDK', style: 'camel', install: 'npm install tigertag' });
    expect(v.version).toBe(require('../package.json').version);
  });

  test('POST /api/build (snake_case fields) → POST /api/parse round trip', async () => {
    const built = await (await post('/api/build', {
      id_material: 38219, id_aspect_1: 104, id_type: 142, id_brand: 57632, measure: 1000, id_unit: 21,
      color1_r: 1, color1_g: 2, color1_b: 3, color1_a: 255, tag_count: 2, tag_index: 1, timestamp: 5, measure_available: 800,
    })).json();
    expect(built.payload).toMatch(/^[0-9a-f]{160}$/);
    expect(built).toMatchObject({ tag_info: 0x12, tag_count: 2, tag_index: 1 });
    const parsed = await (await post('/api/parse', { uid: '04aabbccddeeff', payload: built.payload })).json();
    for (const k of ['pretty', 'describe', 'verify', 'raw_dict', 'dict', 'validate', 'tag_info', 'tag_count', 'tag_index']) {
      expect(parsed).toHaveProperty(k);
    }
    expect(parsed.raw_dict.measure_available).toBe(800);
  });

  test('GET /api/nfc/events: readers:status first (SSE)', async () => {
    const ctrl = new AbortController();
    const resp = await fetch(`${base}/api/nfc/events`, { signal: ctrl.signal });
    expect(resp.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = resp.body.getReader();
    const { value } = await reader.read();
    ctrl.abort();
    const text = Buffer.from(value).toString('utf8');
    expect(text.startsWith('data: ')).toBe(true);
    const msg = JSON.parse(text.slice(6).split('\n\n')[0]);
    expect(msg).toMatchObject({ type: 'readers:status', readers: [], nfc: false, hint: 'npm install ws nfc-pcsc' });
  });

  test('POST /api/nfc/plan: 36 UPDATE BINARY APDUs, signature pages always 00', async () => {
    const payload = 'ab'.repeat(80) + 'cd'.repeat(64);
    const plan = await (await post('/api/nfc/plan', { payload })).json();
    expect(plan.pages).toBe(36);
    expect(plan.signature_dropped).toBe(true);
    expect(plan.apdus[0]).toBe('FF D6 00 04 04 AB AB AB AB');
    expect(plan.apdus[20]).toBe('FF D6 00 18 04 00 00 00 00');
    expect(plan.apdus[35]).toBe('FF D6 00 27 04 00 00 00 00');
    expect((await post('/api/nfc/plan', { payload: 'ab'.repeat(10) })).status).toBe(400);
  });

  test('POST /api/nfc/burn: bad length → 400; no reader → just burn:done', async () => {
    expect((await post('/api/nfc/burn', { payload: 'ab' })).status).toBe(400);
    const out = await (await post('/api/nfc/burn', { reqId: 7, payload: '00'.repeat(80) })).json();
    expect(out.messages).toEqual([{ type: 'burn:done', reqId: 7 }]);
    const read = await (await post('/api/nfc/read', { reqId: 8 })).json();
    expect(read.messages).toEqual([{ type: 'read:done', reqId: 8 }]);
  });

  test('GET /api/db/table/<file> serves the table in use; /api/db/info lists them by file', async () => {
    const r = await fetch(`${base}/api/db/table/id_material.json`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-tigertag-source')).toBe('bundled');
    expect(Array.isArray(await r.json())).toBe(true);
    expect((await fetch(`${base}/api/db/table/nope.json`)).status).toBe(404);
    const info = await (await fetch(`${base}/api/db/info`)).json();
    expect(Object.keys(info.tables)).toContain('id_material.json');
    expect(info).toMatchObject({ offline: true, custom: false });
  });

  test('GET /api/catalog/<id> works offline from the bundled copy', async () => {
    const out = await (await fetch(`${base}/api/catalog/3527039449`)).json();
    expect(out.entry.title).toBe('Rapid TPU 95A - Black');
    expect(out.fields).toMatchObject({ product_id: 3527039449, nozzle_temp_min: 200, id_aspect_2: 0 });
    expect(out.catalog.source).toBe('bundled');
    expect((await fetch(`${base}/api/catalog/123`)).status).toBe(404);
  });
});
