/**
 * generate_fixtures.js — Generate TigerTag test fixture .bin files.
 *
 * Produces one .bin file per test scenario in test/fixtures/.
 * Each file can be loaded with TigerTag.fromDump() or TigerTag.fromFile()
 * without any NFC hardware.
 *
 * Run:
 *   node scripts/generate_fixtures.js
 *
 * Fixtures generated:
 *   tigertag_pla_rosa3d.bin         80B   TigerTag  — PLA Rosa3D Red, full stock
 *   tigertag_petg_bambu_silk.bin    80B   TigerTag  — PETG Silk Bambu Lab, Blue
 *   tigertag_pla_bicolor.bin        80B   TigerTag  — PLA Bicolor Polymaker, Orange+Black
 *   tigertag_resin_generic.bin      80B   TigerTag  — Castable Resin Generic, 500ml
 *   tigertag_low_stock.bin          80B   TigerTag  — PLA eSun, 15% remaining
 *   tigertag_plus_bambu.bin         80B   TigerTag+ — PETG Bambu Lab, cloud product ID
 *   tigertag_init.bin               80B   TigerTag Init — blank/uninitialized chip
 *   tigertag_full_dump.bin         180B   TigerTag  — full chip dump, UID auto-extractable
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { TigerTag, TigerTagDB } = require('../src/index');

const FIXTURES_DIR = path.join(__dirname, '..', 'test', 'fixtures');

// ── TigerTag epoch helpers ────────────────────────────────────────────────────

const EPOCH = new Date('2000-01-01T00:00:00Z').getTime();

function ts(year, month, day) {
  return Math.floor((new Date(Date.UTC(year, month - 1, day)).getTime() - EPOCH) / 1000);
}

// ── Binary packing helpers ────────────────────────────────────────────────────

function buildPayload({
  idTigertag, idProduct,
  idMaterial, idAspect1, idAspect2, idType, idDiameter, idBrand,
  color1 = [0, 0, 0, 0xFF],
  measure = 0, idUnit = 0x15,
  nozzleMin = 0, nozzleMax = 0,
  dryTemp = 0, dryTime = 0,
  bedMin = 0, bedMax = 0,
  timestamp = 0,
  color2 = [0, 0, 0],
  color3 = [0, 0, 0],
  tdRaw = 0,
  customMessage = '',
  measureAvailable,
}) {
  const buf = Buffer.alloc(80);
  let o = 0;

  const p32 = (v) => { buf.writeUInt32BE(v >>> 0, o); o += 4; };
  const p16 = (v) => { buf.writeUInt16BE(v & 0xFFFF, o); o += 2; };
  const p24 = (v) => { buf[o++] = (v >> 16) & 0xFF; buf[o++] = (v >> 8) & 0xFF; buf[o++] = v & 0xFF; };
  const p8  = (v) => { buf[o++] = v & 0xFF; };

  p32(idTigertag);
  p32(idProduct);
  p16(idMaterial);
  p8(idAspect1); p8(idAspect2);
  p8(idType); p8(idDiameter);
  p16(idBrand);
  p8(color1[0]); p8(color1[1]); p8(color1[2]); p8(color1[3]);
  p24(measure); p8(idUnit);
  p16(nozzleMin); p16(nozzleMax);
  p8(dryTemp); p8(dryTime);
  p8(bedMin); p8(bedMax);
  p32(timestamp);
  p8(color2[0]); p8(color2[1]); p8(color2[2]); p8(0);  // color2 RGB + pad
  p8(color3[0]); p8(color3[1]); p8(color3[2]); p8(0);  // color3 RGB + pad
  p16(tdRaw); p16(0);                                    // tdRaw + pad

  const msgBuf = Buffer.alloc(28, 0);
  if (customMessage) {
    const encoded = Buffer.from(customMessage, 'utf8').subarray(0, 28);
    encoded.copy(msgBuf, 0);
  }
  msgBuf.copy(buf, o); o += 28;

  p24(measureAvailable !== undefined ? measureAvailable : measure);
  p8(0);  // pad

  return buf;
}

function wrapFullDump(payload, uidHex) {
  // Reconstruct 180-byte full dump (45 pages × 4 bytes)
  // Pages 0–3: system pages with UID
  const uid = Buffer.from(uidHex, 'hex');  // 7 bytes
  const dump = Buffer.alloc(180, 0);

  // Page 0: uid[0..2] + BCC0
  dump[0] = uid[0]; dump[1] = uid[1]; dump[2] = uid[2]; dump[3] = uid[0] ^ uid[1] ^ uid[2] ^ 0x88;
  // Page 1: uid[3..6]
  dump[4] = uid[3]; dump[5] = uid[4]; dump[6] = uid[5]; dump[7] = uid[6];
  // Page 2: BCC1 + lock bytes
  dump[8] = uid[3] ^ uid[4] ^ uid[5] ^ uid[6];
  // Pages 3 (capability container) through end: zeros already
  // Pages 4–43: user data (40 pages × 4 = 160 bytes)
  payload.copy(dump, 16);

  return dump;
}

// ── Protocol constants ────────────────────────────────────────────────────────

const ID_TIGERTAG      = 0x5BF59264;
const ID_TIGERTAG_PLUS = 0xBC0FCB97;
const ID_TIGERTAG_INIT = 0x6C41A2E1;

const MAKER = 0xFFFFFFFF;
const INIT  = 0x00000000;

// Material IDs (from bundled id_material.json)
const MAT_PLA   = 0x954B;  // 38219
const MAT_PETG  = 0x9570;  // 38256
const MAT_RESIN = 0x20CA;  // 8394

// Brand IDs (from bundled id_brand.json)
const BRAND_ROSA3D    = 0x4DF9;  // 19961
const BRAND_BAMBU_LAB = 0x8933;  // 35123
const BRAND_POLYMAKER = 0xC5AC;  // 50604
const BRAND_ESUN      = 0xBB3A;  // 47930
const BRAND_PRUSAMENT  = 0xB538;  // 46392
const BRAND_GENERIC   = 0xFFFF;  // 65535

// Type IDs
const TYPE_FILAMENT = 0x8E;
const TYPE_RESIN    = 0xAD;

// Diameter IDs
const DIA_175  = 0x38;
const DIA_NONE = 0x00;

// Unit IDs
const UNIT_G  = 0x15;
const UNIT_ML = 0x30;

// Aspect IDs (from bundled id_aspect.json)
const ASP_NONE     = 0x00;
const ASP_BASIC    = 0x68;  // 104
const ASP_SILK     = 0x5C;  // 92
const ASP_MATT     = 0xF7;  // 247
const ASP_GLITTER  = 0x40;  // 64
const ASP_BICOLOR  = 0xFC;  // 252

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    filename: 'tigertag_pla_rosa3d.bin',
    description: 'TigerTag — PLA Rosa3D Red, full stock',
    uid: '04A1B2C3D4E5F6',
    payload: buildPayload({
      idTigertag: ID_TIGERTAG, idProduct: MAKER,
      idMaterial: MAT_PLA, idAspect1: ASP_BASIC, idAspect2: ASP_NONE,
      idType: TYPE_FILAMENT, idDiameter: DIA_175, idBrand: BRAND_ROSA3D,
      color1: [0xFF, 0x00, 0x00, 0xFF],
      measure: 1000, idUnit: UNIT_G,
      nozzleMin: 195, nozzleMax: 230,
      dryTemp: 50, dryTime: 5,
      bedMin: 50, bedMax: 60,
      timestamp: ts(2024, 3, 26),
      tdRaw: 230,
      customMessage: 'Starter Red',
    }),
  },
  {
    filename: 'tigertag_petg_bambu_silk.bin',
    description: 'TigerTag — PETG Silk Bambu Lab, Blue',
    uid: '04B2C3D4E5F607',
    payload: buildPayload({
      idTigertag: ID_TIGERTAG, idProduct: MAKER,
      idMaterial: MAT_PETG, idAspect1: ASP_SILK, idAspect2: ASP_NONE,
      idType: TYPE_FILAMENT, idDiameter: DIA_175, idBrand: BRAND_BAMBU_LAB,
      color1: [0x00, 0x80, 0xFF, 0xFF],
      measure: 1000, idUnit: UNIT_G,
      nozzleMin: 230, nozzleMax: 250,
      dryTemp: 65, dryTime: 8,
      bedMin: 70, bedMax: 90,
      timestamp: ts(2024, 6, 10),
      tdRaw: 95,
      customMessage: 'Bambu PETG Silk Blue',
    }),
  },
  {
    filename: 'tigertag_pla_bicolor.bin',
    description: 'TigerTag — PLA Bicolor Polymaker, Orange+Black',
    uid: '04C3D4E5F60718',
    payload: buildPayload({
      idTigertag: ID_TIGERTAG, idProduct: MAKER,
      idMaterial: MAT_PLA, idAspect1: ASP_BICOLOR, idAspect2: ASP_NONE,
      idType: TYPE_FILAMENT, idDiameter: DIA_175, idBrand: BRAND_POLYMAKER,
      color1: [0xFF, 0x80, 0x00, 0xFF],
      color2: [0x10, 0x10, 0x10],
      measure: 1000, idUnit: UNIT_G,
      nozzleMin: 190, nozzleMax: 220,
      dryTemp: 50, dryTime: 5,
      bedMin: 25, bedMax: 60,
      timestamp: ts(2024, 4, 1),
      tdRaw: 180,
      customMessage: 'PolyTwin Orange-Black',
    }),
  },
  {
    filename: 'tigertag_resin_generic.bin',
    description: 'TigerTag — Castable Resin Generic, 500ml',
    uid: '04D4E5F6071829',
    payload: buildPayload({
      idTigertag: ID_TIGERTAG, idProduct: MAKER,
      idMaterial: MAT_RESIN, idAspect1: ASP_NONE, idAspect2: ASP_NONE,
      idType: TYPE_RESIN, idDiameter: DIA_NONE, idBrand: BRAND_GENERIC,
      color1: [0xCC, 0xCC, 0xFF, 0xCC],
      measure: 500, idUnit: UNIT_ML,
      nozzleMin: 0, nozzleMax: 0,
      dryTemp: 0, dryTime: 0,
      bedMin: 25, bedMax: 35,
      timestamp: ts(2024, 1, 15),
      tdRaw: 0,
      customMessage: 'Castable Resin 500ml',
    }),
  },
  {
    filename: 'tigertag_low_stock.bin',
    description: 'TigerTag — PLA eSun Green, 150g remaining (15% of 1000g)',
    uid: '04E5F60718293A',
    payload: buildPayload({
      idTigertag: ID_TIGERTAG, idProduct: MAKER,
      idMaterial: MAT_PLA, idAspect1: ASP_MATT, idAspect2: ASP_NONE,
      idType: TYPE_FILAMENT, idDiameter: DIA_175, idBrand: BRAND_ESUN,
      color1: [0x22, 0xAA, 0x44, 0xFF],
      measure: 1000, idUnit: UNIT_G,
      nozzleMin: 200, nozzleMax: 230,
      dryTemp: 50, dryTime: 4,
      bedMin: 50, bedMax: 60,
      timestamp: ts(2023, 11, 20),
      tdRaw: 165,
      customMessage: 'eSun PLA+ Green',
      measureAvailable: 150,
    }),
  },
  {
    filename: 'tigertag_plus_bambu.bin',
    description: 'TigerTag+ — PETG Bambu Lab, cloud product ID 0x00001234',
    uid: '04F60718293A4B',
    payload: buildPayload({
      idTigertag: ID_TIGERTAG_PLUS, idProduct: 0x00001234,
      idMaterial: MAT_PETG, idAspect1: ASP_BASIC, idAspect2: ASP_NONE,
      idType: TYPE_FILAMENT, idDiameter: DIA_175, idBrand: BRAND_BAMBU_LAB,
      color1: [0xFF, 0xFF, 0xFF, 0xFF],
      measure: 1000, idUnit: UNIT_G,
      nozzleMin: 230, nozzleMax: 260,
      dryTemp: 65, dryTime: 8,
      bedMin: 70, bedMax: 90,
      timestamp: ts(2024, 10, 5),
      tdRaw: 0,
      customMessage: 'Bambu PETG HF White',
    }),
  },
  {
    filename: 'tigertag_init.bin',
    description: 'TigerTag Init — blank/uninitialized chip',
    uid: '0407182940516273',  // will be truncated to 7 bytes
    payload: buildPayload({
      idTigertag: ID_TIGERTAG_INIT, idProduct: INIT,
      idMaterial: 0, idAspect1: ASP_NONE, idAspect2: ASP_NONE,
      idType: 0, idDiameter: 0, idBrand: 0,
      color1: [0, 0, 0, 0],
      measure: 0, idUnit: UNIT_G,
      nozzleMin: 0, nozzleMax: 0,
      dryTemp: 0, dryTime: 0,
      bedMin: 0, bedMax: 0,
      timestamp: 0,
    }),
  },
  {
    filename: 'tigertag_full_dump.bin',
    description: 'TigerTag — PLA Prusament Galaxy Black, 180B full dump',
    uid: '04AABBCCDDEEFF',
    size: 180,
    payload: null,  // built below
  },
];

// Build the full dump
const fullDumpPayload = buildPayload({
  idTigertag: ID_TIGERTAG, idProduct: MAKER,
  idMaterial: MAT_PLA, idAspect1: ASP_GLITTER, idAspect2: ASP_NONE,
  idType: TYPE_FILAMENT, idDiameter: DIA_175, idBrand: BRAND_PRUSAMENT,
  color1: [0x18, 0x18, 0x28, 0xFF],
  measure: 1000, idUnit: UNIT_G,
  nozzleMin: 210, nozzleMax: 230,
  dryTemp: 50, dryTime: 4,
  bedMin: 60, bedMax: 70,
  timestamp: ts(2024, 7, 4),
  tdRaw: 110,
  customMessage: 'Galaxy Black',
});
FIXTURES[FIXTURES.length - 1].payload = wrapFullDump(fullDumpPayload, FIXTURES[FIXTURES.length - 1].uid);

// ── Generate ──────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  const db = new TigerTagDB();

  console.log(`Generating ${FIXTURES.length} fixture(s) → ${FIXTURES_DIR}/\n`);

  for (const spec of FIXTURES) {
    const filePath = path.join(FIXTURES_DIR, spec.filename);
    const uid      = Buffer.from(spec.uid.replace(/\s/g, '').substring(0, 14), 'hex');
    const payload  = spec.payload;

    fs.writeFileSync(filePath, payload);

    let ok, material, brand, status;
    try {
      const tag = (payload.length === 180)
        ? TigerTag.fromDump(payload)
        : TigerTag.fromPages(uid, payload);

      const sig = tag.verify(db);
      const d   = tag.toDict(db);
      material  = d.material ? TigerTagDB.label(d.material) : '—';
      brand     = d.brand    ? TigerTagDB.label(d.brand)    : '—';
      status    = String(sig);
      ok        = '✓';
    } catch (err) {
      material = brand = '—';
      status = `ERROR: ${err.message}`;
      ok = '✗';
    }

    const size = payload.length;
    const namePad  = spec.filename.padEnd(35);
    const matPad   = material.substring(0, 16).padEnd(16);
    const brandPad = brand.substring(0, 14).padEnd(14);
    console.log(`  ${ok}  ${namePad}  ${String(size).padStart(3)}B  ${matPad} ${brandPad}  ${status}`);

    if (ok === '✗') process.exit(1);
  }

  console.log('\nDone. Load any fixture with:');
  console.log("  const { TigerTag } = require('tigertag');");
  console.log("  const tag = TigerTag.fromFile('test/fixtures/tigertag_pla_rosa3d.bin');");
  console.log("  console.log(tag.pretty());");
}

main();
