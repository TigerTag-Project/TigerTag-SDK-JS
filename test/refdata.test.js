'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { TigerTag, TigerTagDB, loadCatalog } = require('../src/index');
const { clearCatalogMemo } = require('../src/catalog');
const { makeFetch, bundledLastUpdate } = require('./helpers/mock_fetch');

const BUNDLED = path.join(__dirname, '..', 'database');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tigertag-ref-'));
const ONLINE = { offline: false };

let dataDir;
beforeEach(() => { dataDir = tmp(); clearCatalogMemo(); });
afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function writeDownloaded(dir, file, data, key, ts) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(data));
  const luFile = path.join(dir, 'last_update.json');
  const lu = fs.existsSync(luFile) ? JSON.parse(fs.readFileSync(luFile, 'utf8')) : {};
  lu[key] = ts;
  fs.writeFileSync(luFile, JSON.stringify(lu));
}

describe('reference tables: precedence', () => {
  test('bundled copy by default, no network with offline', () => {
    const fetch = makeFetch();
    const db = new TigerTagDB({ dataDir, offline: true, fetch });
    expect(db.material(38219).label).toBe('PLA');
    expect(db.info().tables.filament_materials.source).toBe('bundled');
    expect(fetch.calls).toEqual([]);
  });

  test('a downloaded table newer than the bundled one wins; an older one is ignored', () => {
    const lu = bundledLastUpdate();
    writeDownloaded(dataDir, 'id_brand.json', [{ id: 1, name: 'Newer' }], 'brands', lu.brands + 1);
    writeDownloaded(dataDir, 'id_type.json', [{ id: 142, label: 'Older' }], 'types', lu.types - 1);
    const db = new TigerTagDB({ dataDir, offline: true });
    expect(db.brand(1).name).toBe('Newer');
    expect(db.info().tables.brands.source).toBe('downloaded');
    expect(db.type(142).label).toBe('Filament');
    expect(db.info().tables.types.source).toBe('bundled');
  });

  test('custom dbPath is used exclusively: missing file → clear error, no fallback', () => {
    const custom = tmp();
    for (const f of TigerTagDB.REQUIRED_FILES) fs.copyFileSync(path.join(BUNDLED, f), path.join(custom, f));
    fs.writeFileSync(path.join(custom, 'id_brand.json'), JSON.stringify([{ id: 7, name: 'Mine' }]));
    const db = new TigerTagDB({ dbPath: custom });
    expect(db.brand(7).name).toBe('Mine');
    expect(db.brand(19961)).toBeNull();   // not silently taken from the bundled copy
    expect(db.info().tables.brands.source).toBe('custom');

    fs.rmSync(path.join(custom, 'id_type.json'));
    expect(() => new TigerTagDB({ dbPath: custom })).toThrow(/missing: id_type\.json.*used exclusively/s);
    fs.rmSync(custom, { recursive: true, force: true });
  });

  test('custom dbPath never triggers the automatic check', async () => {
    const custom = tmp();
    for (const f of TigerTagDB.REQUIRED_FILES) fs.copyFileSync(path.join(BUNDLED, f), path.join(custom, f));
    const fetch = makeFetch();
    const db = await TigerTagDB.open({ dbPath: custom, ...ONLINE, fetch });
    await db.ready;
    expect(fetch.calls).toEqual([]);
    fs.rmSync(custom, { recursive: true, force: true });
  });
});

describe('reference tables: automatic daily check', () => {
  test('open(): one last_update request, only the changed table is downloaded', async () => {
    const lu = { ...bundledLastUpdate(), brands: bundledLastUpdate().brands + 10 };
    const fetch = makeFetch({ lastUpdate: lu, tables: { 'id_brand.json': [{ id: 1, name: 'Fresh' }] } });
    const db = await TigerTagDB.open({ dataDir, ...ONLINE, fetch });
    expect(fetch.calls.filter((u) => u.includes('last_update'))).toHaveLength(1);
    expect(fetch.calls.filter((u) => !u.includes('last_update'))).toEqual([
      'https://api.tigertag.io/api:tigertag/brand/get/all',
    ]);
    expect(db.brand(1).name).toBe('Fresh');
    expect(db.info().tables.brands.source).toBe('downloaded');
    expect(db.info().lastCheck).not.toBeNull();
  });

  test('throttled: at most once per maxAge (default 1 day)', async () => {
    const fetch = makeFetch();
    await TigerTagDB.open({ dataDir, ...ONLINE, fetch });
    const n = fetch.calls.length;
    await TigerTagDB.open({ dataDir, ...ONLINE, fetch });
    expect(fetch.calls.length).toBe(n);   // checked less than a day ago
    const st = path.join(dataDir, 'db_state.json');
    const s = JSON.parse(fs.readFileSync(st, 'utf8'));
    s.lastCheck = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    fs.writeFileSync(st, JSON.stringify(s));
    await TigerTagDB.open({ dataDir, ...ONLINE, fetch });
    expect(fetch.calls.length).toBeGreaterThan(n);
  });

  test('API down → GitHub mirror; everything down → no throw, bundled data kept', async () => {
    const lu = { ...bundledLastUpdate(), aspects: bundledLastUpdate().aspects + 1 };
    const mirror = makeFetch({ lastUpdate: lu, failApi: true });
    await TigerTagDB.open({ dataDir, ...ONLINE, fetch: mirror });
    expect(mirror.calls.some((u) => u.startsWith('https://raw.githubusercontent.com') && u.endsWith('id_aspect.json'))).toBe(true);

    const other = tmp();
    const down = makeFetch({ failAll: true });
    const db = await TigerTagDB.open({ dataDir: other, ...ONLINE, fetch: down });
    expect(db.material(38219).label).toBe('PLA');
    expect(db.info().lastError).toMatch(/unreachable/);
    fs.rmSync(other, { recursive: true, force: true });
  });

  test('constructor: background check, non-blocking, db.ready resolves', async () => {
    const other = tmp();
    const lu = { ...bundledLastUpdate(), brands: bundledLastUpdate().brands + 5 };
    const fetch = makeFetch({ lastUpdate: lu, tables: { 'id_brand.json': [{ id: 2, name: 'Bg' }] } });
    const db = new TigerTagDB({ dataDir: other, ...ONLINE, fetch });
    expect(db.brand(2)).toBeNull();          // constructor did not wait
    await db.ready;
    expect(db.brand(2).name).toBe('Bg');     // reloaded when the check finished
    fs.rmSync(other, { recursive: true, force: true });
  });

  test('autoUpdate: false (and the deprecated autoSync: false) disable the automatic check', async () => {
    const fetch = makeFetch();
    await TigerTagDB.open({ dataDir, ...ONLINE, fetch, autoUpdate: false });
    new TigerTagDB({ dataDir: tmp(), ...ONLINE, fetch, autoSync: false });
    expect(fetch.calls).toEqual([]);
  });
});

describe('offline switch', () => {
  test('offline: true and TIGERTAG_OFFLINE=1 → fetch is never called', async () => {
    const fetch = makeFetch();
    const db = await TigerTagDB.open({ dataDir, offline: true, fetch });
    await db.ready;
    await expect(db.update()).rejects.toThrow(/offline/);
    const envDb = await TigerTagDB.open({ dataDir, fetch });   // env set by test/setup-env.js
    await envDb.ready;
    await loadCatalog({ dataDir, fetch, force: true });
    await TigerTag.fromCatalog(3527039449, { dataDir, fetch, force: true });
    expect(fetch.calls).toEqual([]);
  });
});

describe('manual update', () => {
  test('update() downloads changed tables; force re-downloads all; returns the files', async () => {
    const lu = { ...bundledLastUpdate(), measure_units: bundledLastUpdate().measure_units + 1 };
    const fetch = makeFetch({ lastUpdate: lu });
    const db = new TigerTagDB({ dataDir, ...ONLINE, fetch, autoUpdate: false });
    expect(await db.update()).toEqual(['id_measure_unit.json', 'last_update.json']);
    expect(await db.update()).toEqual([]);
    const all = await db.update({ force: true });
    expect(all).toHaveLength(8);
    expect(await db.sync()).toEqual([]);   // deprecated alias
  });

  test('update({ catalog: true }) also refreshes the catalogue', async () => {
    const tables = makeFetch();
    const fetch = async (url, opts) => (url.includes('id_catalog.json')
      ? { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify([{ id: 5, title: 'X', RFID_Data: null }]) }
      : tables(url, opts));
    const db = new TigerTagDB({ dataDir, ...ONLINE, fetch, autoUpdate: false });
    const files = await db.update({ catalog: true });
    expect(files).toContain('id_catalog.json');
    expect(db.info().catalog).toMatchObject({ downloaded: true, source: 'downloaded', count: 1 });
  });
});

describe('info()', () => {
  test('per-table source / path / timestamp, data dir, offline, catalogue', () => {
    const info = new TigerTagDB({ dataDir, offline: true }).info();
    expect(info).toMatchObject({ offline: true, dataDir: path.resolve(dataDir), customDir: null, lastCheck: null });
    expect(Object.keys(info.tables)).toHaveLength(7);
    expect(info.tables.versions).toMatchObject({ file: 'id_version.json', source: 'bundled' });
    expect(info.tables.versions.timestamp).toBe(bundledLastUpdate().versions);
    expect(info.catalog).toMatchObject({ source: 'bundled', downloaded: false });
    expect(info.catalog.count).toBeGreaterThan(10000);
  });
});

describe('catalogue: bundled gzip copy', () => {
  test('fromCatalog works offline from database/id_catalog.json.gz', async () => {
    const tag = await TigerTag.fromCatalog(3527039449, { dataDir, offline: true, timestamp: 1 });
    expect(tag.idProduct).toBe(3527039449);
    expect([tag.nozzleTempMin, tag.nozzleTempMax, tag.measure]).toEqual([200, 250, 1000]);
  });
});

describe('CLI', () => {
  const cli = path.join(__dirname, '..', 'bin', 'tigertag.js');
  const preload = path.join(__dirname, 'helpers', 'cli_mock_fetch.js');

  test('tigertag update --data-dir PATH downloads the changed tables', () => {
    const env = { ...process.env, TIGERTAG_OFFLINE: '', TIGERTAG_MOCK_BRANDS_TS: String(bundledLastUpdate().brands + 1) };
    const out = execFileSync(process.execPath, ['-r', preload, cli, 'update', '--data-dir', dataDir], { env, encoding: 'utf8' });
    expect(out).toMatch(/Updated 2 file\(s\): id_brand\.json, last_update\.json/);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'id_brand.json'), 'utf8'))[0].name).toBe('Mock brand');
    const again = execFileSync(process.execPath, ['-r', preload, cli, 'update', '--data-dir', dataDir], { env, encoding: 'utf8' });
    expect(again).toMatch(/already up to date/);
  });

  test('tigertag update --offline fails; parsing with --offline works', () => {
    const r = spawnSync(process.execPath, [cli, 'update', '--offline', '--data-dir', dataDir], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/offline/);
    const fixture = path.join(__dirname, 'fixtures', 'tigertag_pla_rosa3d.bin');
    const p = spawnSync(process.execPath, [cli, fixture, '--offline', '--data-dir', dataDir], { encoding: 'utf8' });
    expect(p.status).toBe(0);
    expect(p.stdout).toMatch(/TigerTag/);
  });
});
