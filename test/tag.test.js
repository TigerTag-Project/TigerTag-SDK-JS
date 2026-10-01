'use strict';

/**
 * TigerTag SDK JavaScript test suite.
 * Mirrors the Python SDK test coverage.
 *
 * Run with: npm test
 */

const path = require('path');
const {
  TigerTag,
  TigerTagDB,
  SignatureResult,
  MAKER_PRODUCT_ID,
  INIT_PRODUCT_ID,
  ID_TIGERTAG,
  ID_TIGERTAG_PLUS,
  ID_TIGERTAG_INIT,
} = require('../src/index');

const FIXTURES = path.join(__dirname, 'fixtures');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal valid 80- or 144-byte TigerTag payload in-memory.
 */
function makePayload({
  idTigertag    = 0x01000001,
  idProduct     = 0xFFFFFFFF,
  idMaterial    = 38219,
  idAspect1     = 1,
  idAspect2     = 0,
  idType        = 0x8E,
  idDiameter    = 0x38,
  idBrand       = 1,
  color1R       = 255, color1G = 0,   color1B = 0,   color1A = 255,
  measure       = 1000,
  idUnit        = 1,
  nozzleMin     = 190,
  nozzleMax     = 220,
  dryTemp       = 65,
  dryTime       = 8,
  bedMin        = 60,
  bedMax        = 70,
  timestamp     = 700000000,
  color2R       = 0,   color2G = 255, color2B = 0,
  color3R       = 0,   color3G = 0,   color3B = 255,
  tdRaw         = 0,
  tagInfo      = 0,
  customMessage = Buffer.alloc(0),
  measureAvail  = 800,
  includeSig    = false,
} = {}) {
  const buf = Buffer.alloc(80);
  let o = 0;

  buf.writeUInt32BE(idTigertag >>> 0, o); o += 4;
  buf.writeUInt32BE(idProduct   >>> 0, o); o += 4;
  buf.writeUInt16BE(idMaterial, o); o += 2;
  buf[o++] = idAspect1;
  buf[o++] = idAspect2;
  buf[o++] = idType;
  buf[o++] = idDiameter;
  buf.writeUInt16BE(idBrand, o); o += 2;
  buf[o++] = color1R; buf[o++] = color1G; buf[o++] = color1B; buf[o++] = color1A;
  const m = measure & 0xFFFFFF;
  buf[o++] = (m >> 16) & 0xFF; buf[o++] = (m >> 8) & 0xFF; buf[o++] = m & 0xFF;
  buf[o++] = idUnit;
  buf.writeUInt16BE(nozzleMin, o); o += 2;
  buf.writeUInt16BE(nozzleMax, o); o += 2;
  buf[o++] = dryTemp; buf[o++] = dryTime; buf[o++] = bedMin; buf[o++] = bedMax;
  buf.writeUInt32BE(timestamp >>> 0, o); o += 4;
  buf[o++] = color2R; buf[o++] = color2G; buf[o++] = color2B; buf[o++] = tagInfo;
  buf[o++] = color3R; buf[o++] = color3G; buf[o++] = color3B; buf[o++] = 0;
  buf.writeUInt16BE(tdRaw, o); o += 2;
  buf[o++] = 0; buf[o++] = 0;
  const msgBytes = Buffer.isBuffer(customMessage)
    ? customMessage.subarray(0, 28)
    : Buffer.from(customMessage, 'utf8').subarray(0, 28);
  msgBytes.copy(buf, o);
  o += 28;
  const ma = measureAvail & 0xFFFFFF;
  buf[o++] = (ma >> 16) & 0xFF; buf[o++] = (ma >> 8) & 0xFF; buf[o++] = ma & 0xFF;
  buf[o++] = 0;

  if (!includeSig) return buf;
  return Buffer.concat([buf, Buffer.alloc(64)]);
}

/**
 * Wrap a 144-byte payload in a 180-byte full chip dump with a fake UID.
 */
function makeFullDump(payload) {
  const page0   = Buffer.from([0x04, 0xA1, 0xB2, 0xBB]);
  const page1   = Buffer.from([0xC3, 0xD4, 0xE5, 0xF6]);
  const pages23 = Buffer.alloc(8);
  const cfg     = Buffer.alloc(20);
  return Buffer.concat([page0, page1, pages23, payload, cfg]);
}

const TEST_UID = Buffer.from([0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);

// ── Constructors ─────────────────────────────────────────────────────────────

describe('Constructors', () => {
  test('fromPages 80 bytes sets idMaterial and uid', () => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload());
    expect(tag.idMaterial).toBe(38219);
    expect(tag.uid).toEqual(TEST_UID);
  });

  test('fromPages 144 bytes with all-zero sig is not signed', () => {
    const payload = makePayload({ includeSig: true });
    expect(payload.length).toBe(144);
    const tag = TigerTag.fromPages(TEST_UID, payload);
    expect(tag.isSigned).toBe(false);
  });

  test('fromPages rejects invalid payload size', () => {
    expect(() => TigerTag.fromPages(TEST_UID, Buffer.alloc(50))).toThrow();
  });

  test('fromPages rejects invalid UID length', () => {
    expect(() => TigerTag.fromPages(Buffer.alloc(3), makePayload())).toThrow();
  });

  test('fromDump 80 bytes — uid is null', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(tag.uid).toBeNull();
    expect(tag.isSigned).toBe(false);
  });

  test('fromDump 144 bytes', () => {
    const tag = TigerTag.fromDump(makePayload({ includeSig: true }));
    expect(tag.uid).toBeNull();
  });

  test('fromDump 180 bytes extracts UID', () => {
    const dump = makeFullDump(makePayload({ includeSig: true }));
    expect(dump.length).toBe(180);
    const tag = TigerTag.fromDump(dump);
    expect(tag.uid).toEqual(Buffer.from([0x04, 0xA1, 0xB2, 0xC3, 0xD4, 0xE5, 0xF6]));
  });

  test('fromDump rejects invalid size', () => {
    expect(() => TigerTag.fromDump(Buffer.alloc(100))).toThrow();
  });

  test('fromFile loads fixture', () => {
    const tag = TigerTag.fromFile(path.join(FIXTURES, 'tigertag_init.bin'));
    expect(tag).toBeDefined();
  });

  test('fromFile with full 180-byte dump fixture', () => {
    const tag = TigerTag.fromFile(path.join(FIXTURES, 'tigertag_full_dump.bin'));
    expect(tag.uid).not.toBeNull();
  });

  test('fromFile pla_rosa3d fixture parses correctly', () => {
    const tag = TigerTag.fromFile(path.join(FIXTURES, 'tigertag_pla_rosa3d.bin'));
    expect(tag.isMaker || tag.isPlus).toBe(true);
  });
});

// ── validate() ───────────────────────────────────────────────────────────────

describe('validate()', () => {
  test('valid tag returns no warnings', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(tag.validate()).toEqual([]);
  });

  test('nozzle min > max warns', () => {
    const tag = TigerTag.fromDump(makePayload({ nozzleMin: 250, nozzleMax: 200 }));
    expect(tag.validate().some((w) => w.includes('Nozzle'))).toBe(true);
  });

  test('bed min > max warns', () => {
    const tag = TigerTag.fromDump(makePayload({ bedMin: 80, bedMax: 60 }));
    expect(tag.validate().some((w) => w.includes('Bed'))).toBe(true);
  });

  test('measureAvailable > measure warns', () => {
    const tag = TigerTag.fromDump(makePayload({ measure: 500, measureAvail: 600 }));
    expect(tag.validate().some((w) => w.includes('measure_available'))).toBe(true);
  });

  test('tdRaw out of range warns', () => {
    const tag = TigerTag.fromDump(makePayload({ tdRaw: 5 }));
    expect(tag.validate().some((w) => w.includes('TD'))).toBe(true);
  });

  test('tdRaw = 0 is valid (undefined)', () => {
    const tag = TigerTag.fromDump(makePayload({ tdRaw: 0 }));
    expect(tag.validate()).toEqual([]);
  });
});

// ── toBytes() round-trip ─────────────────────────────────────────────────────

describe('toBytes() round-trip', () => {
  test('parse → serialize → parse preserves fields', () => {
    const original = TigerTag.fromDump(makePayload({ idMaterial: 38219, nozzleMin: 190, nozzleMax: 220, measure: 1000 }));
    const serialized = original.toBytes();
    expect(serialized.length).toBe(80);
    const restored = TigerTag.fromDump(serialized);
    expect(restored.idMaterial).toBe(original.idMaterial);
    expect(restored.nozzleTempMin).toBe(original.nozzleTempMin);
    expect(restored.nozzleTempMax).toBe(original.nozzleTempMax);
    expect(restored.measure).toBe(original.measure);
    expect(restored.idTigertag).toBe(original.idTigertag);
  });

  test('toBytes with signature returns 144 bytes', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(tag.toBytes(true).length).toBe(144);
  });

  test('fixture round-trip', () => {
    const tag = TigerTag.fromFile(path.join(FIXTURES, 'tigertag_pla_rosa3d.bin'));
    const bytes = tag.toBytes();
    const tag2  = TigerTag.fromDump(bytes);
    expect(tag2.idMaterial).toBe(tag.idMaterial);
    expect(tag2.nozzleTempMin).toBe(tag.nozzleTempMin);
  });

  test('MAKER_PRODUCT_ID survives round-trip', () => {
    const tag = TigerTag.fromDump(makePayload({ idProduct: 0xFFFFFFFF }));
    expect(tag.idProduct).toBe(0xFFFFFFFF);
    expect(tag.isMaker).toBe(true);
    const tag2 = TigerTag.fromDump(tag.toBytes());
    expect(tag2.isMaker).toBe(true);
  });
});

// ── toDict() ─────────────────────────────────────────────────────────────────

describe('toDict()', () => {
  test('required keys present', () => {
    const tag = TigerTag.fromDump(makePayload());
    const d = tag.toDict();
    for (const key of ['sdk', 'protocol', 'chip', 'uid', 'version', 'product',
      'material', 'brand', 'colors', 'temperatures', 'measure',
      'authentication', 'custom_message', 'manufacturing_date']) {
      expect(d).toHaveProperty(key);
    }
    expect(d.authentication).toHaveProperty('signed');
  });

  test('sdk_mode is offline', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(tag.toDict().sdk_mode).toBe('offline');
  });

  test('sdk is tigertag-sdk-js', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(tag.toDict().sdk).toBe('tigertag-sdk-js');
  });

  test('maker product mode', () => {
    const tag = TigerTag.fromDump(makePayload({ idProduct: 0xFFFFFFFF }));
    expect(tag.toDict().product.mode).toBe('maker');
  });

  test('init product mode', () => {
    const tag = TigerTag.fromDump(makePayload({ idProduct: 0x00000000 }));
    expect(tag.toDict().product.mode).toBe('init');
  });
});

// ── Properties ───────────────────────────────────────────────────────────────

describe('Derived properties', () => {
  test('color1Hex is #RRGGBB uppercase', () => {
    const tag = TigerTag.fromDump(makePayload({ color1R: 255, color1G: 0, color1B: 128 }));
    expect(tag.color1Hex).toBe('#FF0080');
  });

  test('tdValue is tdRaw / 10', () => {
    const tag = TigerTag.fromDump(makePayload({ tdRaw: 123 }));
    expect(tag.tdValue).toBeCloseTo(12.3);
  });

  test('stockPercent is null when measure is 0', () => {
    const tag = TigerTag.fromDump(makePayload({ measure: 0, measureAvail: 0 }));
    expect(tag.stockPercent).toBeNull();
  });

  test('stockPercent computed correctly', () => {
    const tag = TigerTag.fromDump(makePayload({ measure: 1000, measureAvail: 800 }));
    expect(tag.stockPercent).toBe(80.0);
  });

  test('uidHex is uppercase hex or null', () => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload());
    expect(tag.uidHex).toBe('04AABBCCDDEEFF');
  });

  test('uidHex is null without uid', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(tag.uidHex).toBeNull();
  });

  test('isMaker true for 0xFFFFFFFF product', () => {
    const tag = TigerTag.fromDump(makePayload({ idProduct: 0xFFFFFFFF }));
    expect(tag.isMaker).toBe(true);
    expect(tag.isInit).toBe(false);
    expect(tag.isPlus).toBe(false);
  });

  test('isInit true for 0 product', () => {
    const tag = TigerTag.fromDump(makePayload({ idProduct: 0 }));
    expect(tag.isInit).toBe(true);
    expect(tag.isMaker).toBe(false);
  });

  test('manufacturingDate is a Date', () => {
    const tag = TigerTag.fromDump(makePayload({ timestamp: 0 }));
    expect(tag.manufacturingDate).toBeInstanceOf(Date);
    expect(tag.manufacturingDate.getFullYear()).toBe(2000);
  });
});

// ── patch() ──────────────────────────────────────────────────────────────────

describe('patch()', () => {
  test('returns new instance with updated fields', () => {
    const tag  = TigerTag.fromDump(makePayload({ nozzleMin: 190 }));
    const tag2 = tag.patch({ nozzleTempMin: 200 });
    expect(tag2.nozzleTempMin).toBe(200);
    expect(tag.nozzleTempMin).toBe(190);
  });

  test('throws on protected field', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(() => tag.patch({ idTigertag: 0 })).toThrow(/protected/);
  });

  test('throws on unknown field', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(() => tag.patch({ notAField: 42 })).toThrow(/Unknown field/);
  });
});

// ── create() and asInit() ─────────────────────────────────────────────────────

describe('create() and asInit()', () => {
  test('create returns a Maker tag by default', () => {
    const tag = TigerTag.create({
      idMaterial: 38219, idAspect1: 104, idType: 1, idBrand: 19961,
      color1R: 255, color1G: 255, color1B: 255, color1A: 255,
      measure: 1000, idUnit: 1,
    });
    expect(tag.isMaker).toBe(true);
    expect(tag.idMaterial).toBe(38219);
  });

  test('create with productId makes a Plus tag', () => {
    const tag = TigerTag.create({
      productId: 10,
      idMaterial: 38219, idAspect1: 104, idType: 1, idBrand: 19961,
      color1R: 255, color1G: 255, color1B: 255, color1A: 255,
      measure: 1000, idUnit: 1,
    });
    expect(tag.isPlus).toBe(true);
    expect(tag.idTigertag).toBe(ID_TIGERTAG_PLUS);
  });

  test('asInit returns an Init tag', () => {
    const tag = TigerTag.asInit();
    expect(tag.isInit).toBe(true);
    expect(tag.idTigertag).toBe(ID_TIGERTAG_INIT);
  });

  test('erase returns 80 zero bytes', () => {
    const erased = TigerTag.erase();
    expect(erased.length).toBe(80);
    expect(erased.every((b) => b === 0)).toBe(true);
  });
});

// ── SignatureResult ───────────────────────────────────────────────────────────

describe('SignatureResult', () => {
  test('VALID has ok=true', () => {
    const r = new SignatureResult(SignatureResult.VALID);
    expect(r.ok).toBe(true);
  });

  test.each([
    SignatureResult.INVALID,
    SignatureResult.UNSIGNED,
    SignatureResult.NO_CRYPTO,
    SignatureResult.NO_KEY,
    SignatureResult.NO_UID,
  ])('%s has ok=false', (status) => {
    expect(new SignatureResult(status).ok).toBe(false);
  });

  test('toDict returns status, ok, detail', () => {
    const r = new SignatureResult(SignatureResult.UNSIGNED, 'test detail');
    const d = r.toDict();
    expect(d).toHaveProperty('status', SignatureResult.UNSIGNED);
    expect(d).toHaveProperty('ok', false);
    expect(d).toHaveProperty('detail', 'test detail');
  });

  test('toString returns icon', () => {
    expect(String(new SignatureResult(SignatureResult.VALID))).toContain('VALID');
    expect(String(new SignatureResult(SignatureResult.UNSIGNED))).toContain('NOT SIGNED');
  });
});

// ── verify() ─────────────────────────────────────────────────────────────────

describe('verify()', () => {
  test('unsigned tag returns UNSIGNED', () => {
    const tag = TigerTag.fromDump(makePayload());
    expect(tag.verify().status).toBe(SignatureResult.UNSIGNED);
  });

  test('signed tag without UID returns NO_UID', () => {
    const payload = Buffer.concat([makePayload(), Buffer.from(new Uint8Array(32).fill(0xAB)), Buffer.from(new Uint8Array(32).fill(0xCD))]);
    const tag = TigerTag.fromDump(payload);
    expect(tag.uid).toBeNull();
    const result = tag.verify();
    expect(result.status).toBe(SignatureResult.NO_UID);
  });

  test('signed tag with no key in DB returns NO_KEY', () => {
    const payload = Buffer.concat([makePayload(), Buffer.alloc(32, 0xAB), Buffer.alloc(32, 0xCD)]);
    const tag = TigerTag.fromPages(TEST_UID, payload);
    const db = new TigerTagDB();
    db._versions = [];
    const result = tag.verify(db);
    expect(result.status).toBe(SignatureResult.NO_KEY);
  });

  test('ECDSA sign and verify round-trip', () => {
    const { createSign, generateKeyPairSync } = require('crypto');
    const { ecdsaRawToDer } = require('../src/signature');

    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

    const uid        = Buffer.from([0x04, 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF]);
    const idTigertag = 0x01000001;
    const idProduct  = 0xFFFFFFFF;

    const block4 = Buffer.alloc(4); block4.writeUInt32BE(idTigertag, 0);
    const block5 = Buffer.alloc(4); block5.writeUInt32BE(idProduct >>> 0, 0);
    const message = Buffer.concat([uid, block4, block5]);

    const sign = createSign('SHA256');
    sign.update(message);
    const derSig = sign.sign(privateKey);

    // Parse DER to extract r and s
    let offset = 2;
    const rLen = derSig[offset + 1];
    const r = derSig.subarray(offset + 2, offset + 2 + rLen);
    offset += 2 + rLen;
    const sLen = derSig[offset + 1];
    const s = derSig.subarray(offset + 2, offset + 2 + sLen);

    const sigR = Buffer.alloc(32);
    const sigS = Buffer.alloc(32);
    r.subarray(r.length > 32 ? 1 : 0).copy(sigR, 32 - Math.min(r.length, 32));
    s.subarray(s.length > 32 ? 1 : 0).copy(sigS, 32 - Math.min(s.length, 32));

    const payload = Buffer.concat([makePayload({ idTigertag, idProduct }), sigR, sigS]);
    const tag = TigerTag.fromPages(uid, payload);
    expect(tag.isSigned).toBe(true);

    const db = new TigerTagDB();
    db._versions = [{ id: idTigertag, label: 'test', public_key: publicKeyPem }];

    const result = tag.verify(db);
    expect(result.status).toBe(SignatureResult.VALID);
    expect(result.ok).toBe(true);
  });
});

// ── TigerTagDB ───────────────────────────────────────────────────────────────

describe('TigerTagDB', () => {
  test('loads bundled DB without network', () => {
    const db = new TigerTagDB();
    const mat = db.material(38219);
    if (mat) expect(mat.label).toBe('PLA');
  });

  test('unknown id returns null', () => {
    const db = new TigerTagDB();
    expect(db.material(0xDEADBEEF)).toBeNull();
  });

  test('label(null) returns "Unknown"', () => {
    expect(TigerTagDB.label(null)).toBe('Unknown');
  });

  test('label({label: "PLA"}) returns "PLA"', () => {
    expect(TigerTagDB.label({ label: 'PLA' })).toBe('PLA');
  });

  test('bundled DB has all required files', () => {
    const fs = require('fs');
    const { _BUNDLED_DB_PATH } = require('../src/db');
    for (const fn of TigerTagDB.REQUIRED_FILES) {
      expect(fs.existsSync(path.join(_BUNDLED_DB_PATH, fn))).toBe(true);
    }
  });
});

// ── Fixture smoke tests ──────────────────────────────────────────────────────

describe('Fixture smoke tests', () => {
  const fixtures = [
    'tigertag_init.bin',
    'tigertag_pla_rosa3d.bin',
    'tigertag_pla_bicolor.bin',
    'tigertag_low_stock.bin',
    'tigertag_full_dump.bin',
    'tigertag_petg_bambu_silk.bin',
    'tigertag_resin_generic.bin',
    'tigertag_plus_bambu.bin',
  ];

  for (const fixture of fixtures) {
    test(`${fixture} parses without error`, () => {
      const tag = TigerTag.fromFile(path.join(FIXTURES, fixture));
      expect(tag).toBeDefined();
      expect(typeof tag.idTigertag).toBe('number');
      expect(() => tag.validate()).not.toThrow();
    });

    test(`${fixture} toBytes round-trip`, () => {
      const tag   = TigerTag.fromFile(path.join(FIXTURES, fixture));
      const bytes = tag.toBytes();
      expect([80, 144]).toContain(bytes.length);
      const tag2  = TigerTag.fromDump(bytes);
      expect(tag2.idMaterial).toBe(tag.idMaterial);
      expect(tag2.nozzleTempMin).toBe(tag.nozzleTempMin);
    });
  }
});

// ── Tag index / tag count (protocol v2.2) ────────────────────────────────────

describe('Tag index / tag count', () => {
  const REQUIRED = {
    idMaterial: 38219, idAspect1: 1, idType: 0x8E, idBrand: 1,
    measure: 1000, idUnit: 1,
    color1R: 255, color1G: 0, color1B: 0, color1A: 255,
  };

  test.each([
    ['0x00', 0x00, 0, 0],
    ['0x11', 0x11, 1, 1],
    ['0x12', 0x12, 2, 1],
    ['0x22', 0x22, 2, 2],
  ])('parse byte %s → count %i, index %i', (_label, byte, count, index) => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: byte }));
    expect(tag.tagInfo).toBe(byte);
    expect(tag.tagCount).toBe(count);
    expect(tag.tagIndex).toBe(index);
  });

  test('byte +39 round-trips through toBytes()', () => {
    const payload = makePayload({ tagInfo: 0x22 });
    const tag = TigerTag.fromPages(TEST_UID, payload);
    const out = tag.toBytes();
    expect(out[39]).toBe(0x22);
    expect(out.equals(payload)).toBe(true);
  });

  test('create({ tagCount: 2, tagIndex: 2 }) writes 0x22', () => {
    const tag = TigerTag.create({ ...REQUIRED, tagCount: 2, tagIndex: 2 });
    expect(tag.tagInfo).toBe(0x22);
    expect(tag.toBytes()[39]).toBe(0x22);
    expect(tag.validate()).toEqual([]);
  });

  test('twin tag: create() with one explicit timestamp → identical tags except byte +39', () => {
    const ts = 812345678;
    const chip1 = TigerTag.create({ ...REQUIRED, timestamp: ts, tagCount: 2, tagIndex: 1 }).toBytes();
    const chip2 = TigerTag.create({ ...REQUIRED, timestamp: ts, tagCount: 2, tagIndex: 2 }).toBytes();
    expect(chip1.readUInt32BE(32)).toBe(ts);
    expect(chip2.readUInt32BE(32)).toBe(ts);
    expect([chip1[39], chip2[39]]).toEqual([0x12, 0x22]);
    const diff = [...chip1].map((b, i) => (b !== chip2[i] ? i : -1)).filter((i) => i >= 0);
    expect(diff).toEqual([39]);
  });

  test('create() defaults to 0x00 (unknown), asInit() is 0x00', () => {
    expect(TigerTag.create(REQUIRED).tagInfo).toBe(0);
    expect(TigerTag.asInit().toBytes()[39]).toBe(0);
  });

  test('create() rejects values that do not fit in a nibble', () => {
    expect(() => TigerTag.create({ ...REQUIRED, tagCount: 16 })).toThrow(RangeError);
    expect(() => TigerTag.create({ ...REQUIRED, tagIndex: -1 })).toThrow(RangeError);
  });

  test('validate() warns when index > count', () => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: 0x32 }));
    expect(tag.validate().some((w) => w.includes('Tag index (3) > tag count (2)'))).toBe(true);
  });

  test('validate() warns when count is 1 and index > 1', () => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: 0x21 }));
    expect(tag.validate().some((w) => w.includes('Single-tag item'))).toBe(true);
  });

  test('validate() accepts count known / index unknown and count unknown / index set', () => {
    for (const byte of [0x00, 0x02, 0x20, 0x11, 0x12]) {
      const tag = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: byte }));
      expect(tag.validate().filter((w) => /tag (index|count)|single-tag/i.test(w))).toEqual([]);
    }
  });

  test('validate() warns when tagInfo is not a u8', () => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload()).patch({ tagInfo: 0x1FF });
    expect(tag.validate().some((w) => w.includes('out of range'))).toBe(true);
  });

  test('patch() updates count and index independently', () => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: 0x11 }));
    const twin = tag.patch({ tagCount: 2 });
    expect(twin.tagInfo).toBe(0x12);
    const second = twin.patch({ tagIndex: 2 });
    expect(second.tagInfo).toBe(0x22);
    expect(tag.tagInfo).toBe(0x11); // immutable
    expect(tag.patch({ tagInfo: 0x12 }).tagIndex).toBe(1);
    expect(() => tag.patch({ tagIndex: 16 })).toThrow(RangeError);
  });

  test('patchFromRawDict() / fromRawDict() accept tag_info', () => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload());
    expect(tag.patchFromRawDict({ tag_info: 0x22 }).tagInfo).toBe(0x22);
    expect(TigerTag.fromRawDict({ ...tag.toRawDict(), tag_info: 0x12 }).tagInfo).toBe(0x12);
  });

  test('toRawDict() exposes tag_info', () => {
    const tag = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: 0x12 }));
    expect(tag.toRawDict().tag_info).toBe(0x12);
  });

  test('toDict() exposes tag_count / tag_index, null when unknown', () => {
    const d = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: 0x12 })).toDict();
    expect(d.tag_count).toBe(2);
    expect(d.tag_index).toBe(1);
    expect(d.protocol).toBe('TigerTag Open Source v2.2');
    const u = TigerTag.fromPages(TEST_UID, makePayload()).toDict();
    expect(u.tag_count).toBeNull();
    expect(u.tag_index).toBeNull();
    const partial = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: 0x02 })).toDict();
    expect(partial.tag_count).toBe(2);
    expect(partial.tag_index).toBeNull();
  });

  test('describe() names the item from idType: filament, or "item" when unknown', () => {
    const filament = TigerTag.fromPages(TEST_UID, makePayload({ idType: 142, tagInfo: 0x12 }));
    expect(filament.describe()).toContain('Tag 1 of 2 on this filament.');
    const resin = TigerTag.fromPages(TEST_UID, makePayload({ idType: 173, tagInfo: 0x22 }));
    expect(resin.describe()).toContain('Tag 2 of 2 on this resin.');
    const unknown = TigerTag.fromPages(TEST_UID, makePayload({ idType: 0xFE, tagInfo: 0x02 }));
    expect(unknown.describe()).toContain('Tag ? of 2 on this item.');
    expect(TigerTag.fromPages(TEST_UID, makePayload()).describe()).not.toMatch(/Tag \S+ of/);
  });

  test('pretty() prints the tag line', () => {
    const twin = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: 0x12 })).pretty();
    expect(twin).toContain('Tag          1 of 2\n');
    const unknown = TigerTag.fromPages(TEST_UID, makePayload()).pretty();
    expect(unknown).toContain('Tag          ? of ? (unknown)\n');
    const partial = TigerTag.fromPages(TEST_UID, makePayload({ tagInfo: 0x02 })).pretty();
    expect(partial).toContain('Tag          ? of 2\n');
  });

  test('patching only tagCount / tagIndex changes page 0x0D byte 3 and nothing else', () => {
    const payload = makePayload({ color2R: 0x12, color2G: 0x34, color2B: 0x56, includeSig: true });
    const tag = TigerTag.fromPages(TEST_UID, payload);
    const out = tag.patch({ tagCount: 2, tagIndex: 1 }).toBytes(true);
    // Page 0x0D = payload bytes 36–39: color2 RGB + tagInfo
    expect([...out.subarray(36, 40)]).toEqual([0x12, 0x34, 0x56, 0x12]);
    const changed = [...out].map((b, i) => (b !== payload[i] ? i : -1)).filter((i) => i >= 0);
    expect(changed).toEqual([39]);
    // Patching color 2 keeps tagInfo
    const recolored = TigerTag.fromPages(TEST_UID, out).patch({ color2R: 0xAA });
    expect(recolored.toBytes()[39]).toBe(0x12);
  });

  test('signature still verifies after changing tagInfo', () => {
    const { createSign, generateKeyPairSync } = require('crypto');
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });

    const idTigertag = 0x01000001;
    const idProduct  = 0xFFFFFFFF;
    const block4 = Buffer.alloc(4); block4.writeUInt32BE(idTigertag, 0);
    const block5 = Buffer.alloc(4); block5.writeUInt32BE(idProduct >>> 0, 0);

    const sign = createSign('SHA256');
    sign.update(Buffer.concat([TEST_UID, block4, block5]));
    const raw = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });

    const payload = Buffer.concat([makePayload({ idTigertag, idProduct }), raw]);
    const tag = TigerTag.fromPages(TEST_UID, payload);

    const db = new TigerTagDB();
    db._versions = [{ id: idTigertag, label: 'test', public_key: publicKeyPem }];
    expect(tag.verify(db).status).toBe(SignatureResult.VALID);

    const twin = tag.patch({ tagCount: 2, tagIndex: 1 });
    const reread = TigerTag.fromPages(TEST_UID, twin.toBytes(true));
    expect(reread.tagInfo).toBe(0x12);
    expect(reread.verify(db).status).toBe(SignatureResult.VALID);
  });
});
