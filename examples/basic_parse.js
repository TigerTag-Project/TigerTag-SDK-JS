/**
 * basic_parse.js — Minimal TigerTag parse example.
 *
 * Uses real IDs from the official spec (section 4 — Rosa3D Red PLA example).
 * Works offline, no NFC hardware needed.
 *
 * Run:
 *   node examples/basic_parse.js
 */

'use strict';

const path = require('path');
// When installed via npm, use: const { TigerTag } = require('tigertag');
const { TigerTag } = require(path.join(__dirname, '..', 'src', 'index'));

/**
 * Build the Rosa3D Red PLA payload from the official spec (section 4).
 *
 * Real values — not simulated:
 *   ID TigerTag : 0x5BF59264  (TigerTag)
 *   Material    : 0x954B = 38219  (PLA)
 *   Aspect 1    : 0x68 = 104  (Basic)
 *   Type        : 0x8E = 142  (Filament)
 *   Diameter    : 0x38 = 56   (1.75mm)
 *   Brand       : 0x4DF9 = 19961  (Rosa3D)
 *   Unit        : 0x15 = 21   (grams)
 *   TD          : 0x00E6 = 230  (HueForge TD = 23.0)
 */
function makeRosa3dRedPla() {
  const buf = Buffer.alloc(80);
  let o = 0;

  const p32 = (v) => { buf.writeUInt32BE(v >>> 0, o); o += 4; };
  const p16 = (v) => { buf.writeUInt16BE(v & 0xFFFF, o); o += 2; };
  const p24 = (v) => { buf[o++] = (v >> 16) & 0xFF; buf[o++] = (v >> 8) & 0xFF; buf[o++] = v & 0xFF; };
  const p8  = (v) => { buf[o++] = v & 0xFF; };

  p32(0x5BF59264);  // idTigertag — TigerTag
  p32(0xFFFFFFFF);  // idProduct  — Maker (all data on chip)
  p16(0x954B);      // idMaterial — PLA (38219)
  p8(0x68);         // idAspect1  — Basic (104)
  p8(0x00);         // idAspect2  — None
  p8(0x8E);         // idType     — Filament (142)
  p8(0x38);         // idDiameter — 1.75mm (56)
  p16(0x4DF9);      // idBrand    — Rosa3D (19961) — note: spec has typo 0x4E19
  p8(0xFF); p8(0x00); p8(0x00); p8(0xFF);  // Color 1 RGBA — Red, fully opaque
  p24(1000);        // measure    — 1000g initial
  p8(0x15);         // idUnit     — grams (21)
  p16(195);         // nozzleMin  — 195°C
  p16(230);         // nozzleMax  — 230°C
  p8(50);           // dryTemp    — 50°C
  p8(5);            // dryTime    — 5 hours
  p8(50);           // bedMin     — 50°C
  p8(60);           // bedMax     — 60°C
  p32(0x2D94CC80);  // timestamp  — 764726400 s since 2000-01-01 (= 2024-03-26 UTC)
  p8(0); p8(0); p8(0); p8(0);  // Color 2 — none
  p8(0); p8(0); p8(0); p8(0);  // Color 3 — none
  p16(230);         // tdRaw      — HueForge TD = 23.0 (230 / 10)
  p16(0);           // padding

  // customMessage (28 bytes, UTF-8 zero-padded)
  const msg = Buffer.from('Starter Red', 'utf8');
  msg.copy(buf, o, 0, Math.min(msg.length, 28));
  o += 28;

  p24(1000);        // measureAvailable — full spool
  p8(0);            // padding

  return buf;
}

function main() {
  const uid     = Buffer.from('04A1B2C3D4E5F6', 'hex');  // illustrative 7-byte UID
  const payload = makeRosa3dRedPla();

  const tag = TigerTag.fromPages(payload, uid);

  // Human-readable
  console.log(tag.pretty());
  console.log();

  // LLM-ready natural language description
  console.log('=== describe() — for LLM injection ===');
  console.log(tag.describe());
  console.log();

  // Key resolved fields
  const d = tag.toDict();
  console.log(`Material : ${d.material.label}  (density: ${d.material.density} g/cm³)`);
  console.log(`Brand    : ${d.brand.label}`);
  console.log(`Diameter : ${d.diameter.label} ${d.diameter.unit}`);
  console.log(`Nozzle   : ${d.temperatures.onChip.nozzle.min}–${d.temperatures.onChip.nozzle.max} °C`);
  console.log(`HueForge : TD ${tag.tdValue}`);
  console.log(`Stock    : ${d.measure.description}`);
  console.log(`Signed   : ${d.authentication.signed}`);
}

main();
