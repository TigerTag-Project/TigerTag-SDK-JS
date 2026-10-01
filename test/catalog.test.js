'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { TigerTag, ID_TIGERTAG_PLUS } = require('../src/index');
const {
  loadCatalog, refreshCatalog, catalogInfo, catalogEntry, clearCatalogMemo,
} = require('../src/catalog');

// Real entry from id_catalog.json (Elegoo Rapid TPU 95A - Black)
const ELEGOO = {
  RFID_Data: {
    color_a: 255, color_b: 0, color_g: 0, color_r: 0,
    data1: 56, data2: 200, data3: 250, data4: 60, data5: 6, data6: 25, data7: 45,
    id_aspect1: 104, id_aspect2: null, id_brand: 57632, id_material: 43518,
    id_type: 142, id_unit: 21, measure: 1000,
  },
  barcode: '40553085', brand: 'ELEGOO', color: '#000000FF',
  color_info: { colors: ['#000000FF'], type: 'mono' },
  id: 3527039449, img_src: 'https://example.invalid/tpu.jpg', material: 'TPU',
  measure: '1000 g', product_type: 'Filament', sku: '50.203.0631', title: 'Rapid TPU 95A - Black',
};
// Bicolour entry: colours only in color_info
const DUAL = {
  RFID_Data: { ...ELEGOO.RFID_Data, id_aspect1: 247, id_aspect2: 252, data4: null, data5: null,
    color_r: 0xEA, color_g: 0xAD, color_b: 0xBD },
  color_info: { colors: ['#EAADBDFF', '#ED2F2EFF', '#102030FF'], type: 'multi' },
  id: 19278539, title: 'Dual Matte Flamingo',
};
// Colours 2 / 3 given in RFID_Data take precedence over color_info
const RGB3 = {
  RFID_Data: { ...ELEGOO.RFID_Data, color_r2: 1, color_g2: 2, color_b2: 3, color_r3: 4, color_g3: 5, color_b3: 6 },
  color_info: { colors: ['#000000FF', '#FFFFFFFF', '#FFFFFFFF'], type: 'multi' }, id: 42, title: 'Tri',
};
// Resin entries of the catalogue carry no RFID_Data
const RESIN = { id: 1298476103, title: 'Castable - X-Filigree V2', product_type: 'Resin', RFID_Data: null };

const LIST = [ELEGOO, DUAL, RGB3, RESIN];

function mockFetch(body = JSON.stringify(LIST)) {
  const fn = jest.fn(async () => ({ ok: true, status: 200, text: async () => body }));
  return fn;
}

// Online (tests set TIGERTAG_OFFLINE=1 globally), mocked fetch, no bundled copy
const ISOLATED = { offline: false, bundledDir: null };
let cacheDir;
beforeEach(() => {
  clearCatalogMemo();
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tigertag-catalog-'));
});
afterEach(() => fs.rmSync(cacheDir, { recursive: true, force: true }));

describe('TigerTag.fromCatalogEntry / fromCatalog', () => {
  test('Elegoo Rapid TPU 95A Black → expected TigerTag+ bytes', () => {
    const tag = TigerTag.fromCatalogEntry(ELEGOO, { timestamp: 1000 });
    expect(tag.idTigertag).toBe(ID_TIGERTAG_PLUS);
    expect(tag.idProduct).toBe(3527039449);
    expect(tag.toBytes().toString('hex')).toBe(
      'bc0fcb97' + 'd23a59d9' + 'a9fe' + '68' + '00' + '8e' + '38' + 'e120'   // version, product, material, aspects, type, diameter, brand
      + '000000ff' + '0003e8' + '15' + '00c8' + '00fa' + '3c' + '06' + '19' + '2d'     // colour 1, measure, unit, nozzle, dry, bed
      + '000003e8' + '00000000' + '00000000' + '00000000'                              // timestamp, colour 2 + tag info, colour 3, TD
      + '00'.repeat(28) + '0003e8' + '00',                                             // message, measure available
    );
    expect([tag.nozzleTempMin, tag.nozzleTempMax, tag.dryTemp, tag.dryTime, tag.bedTempMin, tag.bedTempMax])
      .toEqual([200, 250, 60, 6, 25, 45]);
    expect([tag.idDiameter, tag.idAspect2, tag.measure, tag.measureAvailable, tag.idUnit]).toEqual([56, 0, 1000, 1000, 21]);
  });

  test('multi-colour: color_info.colors[1..2] → colour 2 / 3; null data → 0', () => {
    const tag = TigerTag.fromCatalogEntry(DUAL, { timestamp: 1 });
    expect(tag.color1Hex).toBe('#EAADBD');
    expect(tag.color2Hex).toBe('#ED2F2E');
    expect(tag.color3Hex).toBe('#102030');
    expect([tag.idAspect1, tag.idAspect2, tag.dryTemp, tag.dryTime]).toEqual([247, 252, 0, 0]);
  });

  test('RFID_Data colour 2 / 3 take precedence over color_info', () => {
    const tag = TigerTag.fromCatalogEntry(RGB3, { timestamp: 1 });
    expect([tag.color2R, tag.color2G, tag.color2B, tag.color3R, tag.color3G, tag.color3B]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('twin tag options and uid pass through', () => {
    const uid = Buffer.from('04AABBCCDDEEFF', 'hex');
    const tag = TigerTag.fromCatalogEntry(ELEGOO, { uid, timestamp: 77, tagCount: 2, tagIndex: 2 });
    expect(tag.tagInfo).toBe(0x22);
    expect(tag.timestamp).toBe(77);
    expect(tag.uidHex).toBe('04AABBCCDDEEFF');
  });

  test('a product without RFID_Data (catalogue resins) → clear error', () => {
    expect(() => TigerTag.fromCatalogEntry(RESIN)).toThrow(/no RFID_Data/);
  });

  test('fromCatalog() looks the ID up; unknown ID → clear error', async () => {
    const catalog = new Map(LIST.map((e) => [e.id, e]));
    const tag = await TigerTag.fromCatalog('3527039449', { catalog, timestamp: 1000 });
    expect(tag.idProduct).toBe(3527039449);
    await expect(TigerTag.fromCatalog(123, { catalog })).rejects.toThrow(/not in the TigerTag catalogue/);
  });
});

describe('loadCatalog / catalogEntry', () => {
  test('downloads once, writes the disk cache, reuses it', async () => {
    const fetch = mockFetch();
    const map = await loadCatalog({ ...ISOLATED, cacheDir, fetch });
    expect(map.size).toBe(4);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(cacheDir, 'id_catalog.json'))).toBe(true);

    clearCatalogMemo();
    const fetch2 = mockFetch('[]');
    const again = await loadCatalog({ ...ISOLATED, cacheDir, fetch: fetch2 });   // fresh disk cache → no download
    expect(again.size).toBe(4);
    expect(fetch2).not.toHaveBeenCalled();
  });

  test('force / expired cache re-downloads', async () => {
    await loadCatalog({ ...ISOLATED, cacheDir, fetch: mockFetch() });
    clearCatalogMemo();
    const fetch = mockFetch(JSON.stringify([ELEGOO]));
    const map = await loadCatalog({ ...ISOLATED, cacheDir, fetch, maxAge: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(map.size).toBe(1);
  });

  test('offline: stale cache is used; no cache → clear error', async () => {
    await loadCatalog({ ...ISOLATED, cacheDir, fetch: mockFetch() });
    clearCatalogMemo();
    const offline = jest.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    const stale = await loadCatalog({ ...ISOLATED, cacheDir, fetch: offline, maxAge: 0 });
    expect(stale.size).toBe(4);

    clearCatalogMemo();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tigertag-catalog-'));
    await expect(loadCatalog({ ...ISOLATED, cacheDir: empty, fetch: offline }))
      .rejects.toThrow(/catalogue unavailable.*no local copy/);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  test('catalogEntry() returns the metadata, null when unknown', async () => {
    const entry = await catalogEntry(3527039449, { ...ISOLATED, cacheDir, fetch: mockFetch() });
    expect(entry).toMatchObject({ title: 'Rapid TPU 95A - Black', brand: 'ELEGOO', sku: '50.203.0631', barcode: '40553085' });
    expect(await catalogEntry(1, { ...ISOLATED, cacheDir, fetch: mockFetch() })).toBeNull();
  });
});

describe('default cache lifetime', () => {
  test('DEFAULT_MAX_AGE_MS is 1 day; a cache older than 1 day is re-checked, a younger one is reused', async () => {
    const { DEFAULT_MAX_AGE_MS } = require('../src/catalog');
    expect(DEFAULT_MAX_AGE_MS).toBe(24 * 3600 * 1000);
    await loadCatalog({ ...ISOLATED, cacheDir, fetch: mockFetch() });
    const file = path.join(cacheDir, 'id_catalog.json');

    clearCatalogMemo();
    const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000);
    fs.utimesSync(file, hoursAgo(23), hoursAgo(23));
    const young = mockFetch();
    await loadCatalog({ ...ISOLATED, cacheDir, fetch: young });
    expect(young).not.toHaveBeenCalled();

    clearCatalogMemo();
    fs.utimesSync(file, hoursAgo(25), hoursAgo(25));
    const old = mockFetch();
    await loadCatalog({ ...ISOLATED, cacheDir, fetch: old });
    expect(old).toHaveBeenCalledTimes(1);
  });
});

describe('refreshCatalog / catalogInfo', () => {
  const headers = (h) => ({ get: (n) => h[n.toLowerCase()] ?? null });

  test('catalogInfo() before the first download → not downloaded', () => {
    expect(catalogInfo({ ...ISOLATED, cacheDir })).toMatchObject({ downloaded: false, count: null, fetchedAt: null });
  });

  test('info after a download: count, fetchedAt, source url, ETag', async () => {
    const fetch = jest.fn(async () => ({
      ok: true, status: 200, headers: headers({ etag: '"v1"', 'last-modified': 'Wed, 30 Sep 2026 10:00:00 GMT' }),
      text: async () => JSON.stringify(LIST),
    }));
    await loadCatalog({ ...ISOLATED, cacheDir, fetch, url: 'https://example.invalid/id_catalog.json' });
    const info = catalogInfo({ ...ISOLATED, cacheDir });
    expect(info).toMatchObject({ downloaded: true, count: 4, url: 'https://example.invalid/id_catalog.json', etag: '"v1"' });
    expect(Date.parse(info.fetchedAt)).not.toBeNaN();
  });

  test('refreshCatalog() forces a check, sends the ETag, keeps the cache on 304', async () => {
    const first = jest.fn(async () => ({
      ok: true, status: 200, headers: headers({ etag: '"v1"' }), text: async () => JSON.stringify(LIST),
    }));
    await loadCatalog({ ...ISOLATED, cacheDir, fetch: first });
    const fetchedAt = catalogInfo({ ...ISOLATED, cacheDir }).fetchedAt;

    const notModified = jest.fn(async () => ({ ok: false, status: 304, headers: headers({}), text: async () => '' }));
    const map = await refreshCatalog({ ...ISOLATED, cacheDir, fetch: notModified });   // memo + fresh cache ignored
    expect(notModified).toHaveBeenCalledTimes(1);
    expect(notModified.mock.calls[0][1].headers['If-None-Match']).toBe('"v1"');
    expect(map.size).toBe(4);
    const info = catalogInfo({ ...ISOLATED, cacheDir });
    expect(info.fetchedAt).toBe(fetchedAt);                 // same copy
    expect(Date.parse(info.checkedAt)).toBeGreaterThanOrEqual(Date.parse(fetchedAt));
  });

  test('refreshCatalog() with a new version replaces the cache', async () => {
    await loadCatalog({ ...ISOLATED, cacheDir, fetch: mockFetch() });
    const updated = jest.fn(async () => ({
      ok: true, status: 200, headers: headers({ etag: '"v2"' }), text: async () => JSON.stringify([ELEGOO, DUAL]),
    }));
    const map = await refreshCatalog({ ...ISOLATED, cacheDir, fetch: updated });
    expect(map.size).toBe(2);
    expect(catalogInfo({ ...ISOLATED, cacheDir })).toMatchObject({ count: 2, etag: '"v2"' });
    clearCatalogMemo();
    expect((await loadCatalog({ ...ISOLATED, cacheDir, fetch: mockFetch('[]') })).size).toBe(2);   // read from the new cache
  });
});
