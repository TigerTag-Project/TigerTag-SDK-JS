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
  buf[o++] = color2R; buf[o++] = color2G; buf[o++] = color2B; buf[o++] = 0;
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
    const tag = TigerTag.create({ idMaterial: 38219 });
    expect(tag.isMaker).toBe(true);
    expect(tag.idMaterial).toBe(38219);
  });

  test('create with productId makes a Plus tag', () => {
    const tag = TigerTag.create({ productId: 10, idMaterial: 38219 });
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
