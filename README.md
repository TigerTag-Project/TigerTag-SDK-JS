# TigerTag JavaScript SDK

[![npm](https://img.shields.io/npm/v/tigertag?color=blue)](https://www.npmjs.com/package/tigertag)
[![Tests](https://github.com/TigerTag-Project/TigerTag-SDK-JS/actions/workflows/test.yml/badge.svg)](https://github.com/TigerTag-Project/TigerTag-SDK-JS/actions/workflows/test.yml)
[![Node](https://img.shields.io/badge/node-18%2B-blue?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: GPLv3](https://img.shields.io/badge/license-GPLv3-green)](LICENSE.md)
[![Protocol](https://img.shields.io/badge/protocol-TigerTag%20v2.1-orange)](https://github.com/TigerTag-Project/TigerTag-RFID-Guide)
[![Offline first](https://img.shields.io/badge/offline-first-teal)](database/)

**Offline JavaScript / Node.js SDK for TigerTag RFID material identification.**

> TigerTag is the **world's most widely deployed open-source RFID protocol** for
> manufacturing material identification — with **over 2 million chips deployed worldwide**.
> Adopted by major brands including **eSun, Rosa3D, Sunlu, R3D, Landu** and many more.
> Currently covers filament and resin. Designed to extend to any physical material
> (sheet goods, wood, PMMA, metals, composites…).
> All material data is stored directly on the NTAG chip — **100% offline**.

---

## Industry adoption

TigerTag is the **#1 RFID material identification protocol** in the 3D printing industry
and the only open-source standard with broad manufacturer adoption at scale.

| Metric | Value |
|--------|-------|
| Chips deployed worldwide | **2 000 000+** |
| Filament / resin brands | eSun · Rosa3D · Sunlu · R3D · Landu · and more |
| Connected printers & slicers | Snapmaker · Bambu Lab · FlashForge · Elegoo · Creality · and more |
| Exclusive integrations | **HueForge** (Transmission Distance) · **TD1s by Ajax** (filament manager) |
| Cost for end users | **100% free** — protocol, SDK, Studio Manager, mobile apps |
| Protocol status | Open source (GPLv3) — free to implement for manufacturers |
| Hardware | Tiger Scale (DIY ~30 € open-source) · TigerTag Pod (read/write desktop + mobile) |
| Ecosystem maturity | Desktop app · Mobile app · Pod · DIY scale · Firebase · Python SDK · JS SDK |
| Chip compatibility | NTAG213 · NTAG215 · NTAG216 · any ISO 14443-3 compatible |

---

## What makes TigerTag unique

**1 — Proof of authenticity (ECDSA-P256)**

TigerTag is the **only material RFID protocol to offer cryptographic proof of authenticity**.
Each signed chip carries an ECDSA-P256 signature that binds the chip UID to the product data.
Any reader — including this SDK — can verify the signature fully offline, with no server call:

```js
const result = tag.verify();   // ✅ VALID — chip is genuine and untampered
                               // ❌ INVALID — data has been modified or chip is cloned
                               // ⬜ NOT SIGNED — unsigned Maker tag (verification not required)
```

No other RFID material protocol provides on-chip cryptographic authentication at this level.

**2 — Chips reusable forever**

TigerTag chips are **never write-locked**. Once a spool is finished, the chip gets a second life:

- Erase and reprogram as a fresh TigerTag for a new spool: `TigerTag.erase()`
- Reprogram with any NFC / NDEF standard for a completely different use case
- Use as a plain NTAG tag in any NFC-capable application

Zero electronic waste. The chip is a permanent, reusable asset — not single-use packaging.

**3 — Remote update by the manufacturer (TigerTag+)**

TigerTag+ is the **only material RFID protocol with remote over-the-air update capability
for manufacturers**. When a brand publishes improved print settings or corrected temperatures
to the TigerTag cloud API, every chip already deployed can receive those updates:

```js
// Fetch latest manufacturer data and apply to chip:
const [patchedTag, changes] = await tag.patchFromApi();
console.log(`${changes.length} field(s) updated by manufacturer`);

// Or inspect what changed before applying:
const diffs = await tag.diffApi();
for (const d of diffs) {
  console.log(`${d.field}: chip=${d.chipValue} → manufacturer=${d.apiValue}`);
}
```

**4 — Native HueForge integration**

TigerTag is the **only RFID protocol natively integrated with HueForge**. The TD (Transmission
Distance) value is stored directly on the chip (`tdValue` property) and read by HueForge
without any manual entry.

---

## Hardware ecosystem

| Device | What it does | Price |
|--------|-------------|-------|
| **Tiger Scale** | Open-source DIY ESP32 smart scale — reads the TigerTag, weighs the spool, updates `measureAvailable` in real time | ~30 € in parts |
| **TigerTag Pod** | Plug-and-play NFC reader/writer — read and write chips from your desktop (via TigerTag Studio Manager) or from your phone (via TigerTag RFID Connect on iOS and Android) | — |

**Everything is free for end users**: the protocol, this SDK, TigerTag Studio Manager,
the mobile apps, and all community tools. No subscription, no lock-in.

---

## Install

```bash
npm install tigertag
```

Zero configuration. Zero network required on first run. Bundled reference databases ship with
the package. Requires **Node.js 18+** (uses built-in `crypto` and `fetch` — no extra deps).

---

## Quick start

```js
const { TigerTag } = require('tigertag');

const tag = TigerTag.fromPages(payload, uid);   // from your NFC SDK
console.log(tag.pretty());                      // human-readable summary
console.log(String(tag.verify()));              // ✅ VALID / ⬜ NOT SIGNED / ❌ INVALID
console.log(tag.toDict());                      // JSON-ready object
```

Works immediately after `npm install tigertag`. No setup required.

---

## What is TigerTag?

TigerTag is an **open-source RFID protocol** that stores manufacturing material data directly
on NFC chips (NTAG213 / NTAG215 / NTAG216, ISO 14443-3 compatible). No cloud dependency
for reading — all data lives on the chip.

**Tag types:**

| Tag type | idProduct | Offline | Cloud |
|---|---|---|---|
| **TigerTag** (Maker) | `0xFFFFFFFF` | ✅ full data on chip | — |
| **TigerTag Init** | `0x00000000` | ✅ blank template | — |
| **TigerTag+** | numeric ID | ✅ full data on chip | ✅ API for live updates |

**Protocol spec:** [github.com/TigerTag-Project/TigerTag-RFID-Guide](https://github.com/TigerTag-Project/TigerTag-RFID-Guide)

---

## Constructors

| Method | Input | When to use |
|--------|-------|-------------|
| `TigerTag.fromPages(payload, uid)` | 80 or 144 bytes + 7-byte UID | **NFC SDK integration (recommended)** |
| `TigerTag.fromDump(data)` | 80 / 144 / 180 bytes | Binary dumps, ACR122U raw read |
| `TigerTag.fromFile(path)` | path to `.bin` file | Testing, offline batch processing |

**`fromPages`** is the primary constructor for production use. NFC SDKs always provide the
UID as a separate property — pass it directly for full signature verification.

**`fromDump` with 180 bytes** (full chip dump including system pages) auto-extracts the 7-byte UID.

---

## Input formats

### `fromPages(payload, uid)` — NFC SDK workflow

NFC SDKs always expose the UID as a dedicated property. Pages 0–3 (system pages: lock bytes,
capability container) are never part of the user data payload.

```js
// Read pages 4–39 from your NFC SDK (36 pages × 4 bytes = 144 bytes with signature)
// or pages 4–23 (20 pages × 4 bytes = 80 bytes without signature)
const payload = /* Buffer(80) or Buffer(144) from your NFC SDK */;
const uid     = /* Buffer(7) — chip UID from your NFC SDK */;

const tag = TigerTag.fromPages(payload, uid);
```

### `fromDump(data)` — binary dump

```js
const { TigerTag } = require('tigertag');
const fs = require('fs');

// 180 bytes: full chip dump (pages 0–44) — UID auto-extracted
const tag = TigerTag.fromDump(fs.readFileSync('dump.bin'));

// 144 bytes: user data + signature
// 80 bytes:  user data only
```

---

## Core API

### Parsing and output

```js
const { TigerTag, TigerTagDB } = require('tigertag');

const tag = TigerTag.fromPages(payload, uid);

// Human-readable summary (all fields resolved via bundled DB)
console.log(tag.pretty());

// LLM-friendly natural language description
console.log(tag.describe());

// Full resolved object (IDs replaced by labels + metadata)
const d = tag.toDict();
console.log(d.material.label);        // "PLA"
console.log(d.brand.label);           // "Rosa3D"
console.log(d.temperatures.onChip.nozzle.min);  // 195

// Raw protocol fields (no DB lookup)
console.log(tag.toRawDict());

// Validation warnings
const warnings = tag.validate();
if (warnings.length) console.warn(warnings.join('\n'));
```

### Signature verification

```js
const result = tag.verify();      // uses bundled public key
console.log(result.ok);           // true / false
console.log(String(result));      // ✅ VALID / ❌ INVALID / ⬜ NOT SIGNED
console.log(result.status);       // 'valid' | 'invalid' | 'unsigned' | 'no_key' | 'no_uid'
```

### Properties

```js
tag.isMaker          // true if id_product === 0xFFFFFFFF
tag.isInit           // true if id_product === 0x00000000
tag.isPlus           // true if cloud TigerTag+
tag.isSigned         // true if ECDSA signature present
tag.uidHex           // "04A1B2C3D4E5F6" or null
tag.color1Hex        // "#FF0000"
tag.tdValue          // 23.0 (td_raw / 10)
tag.manufacturingDate  // Date object
tag.stockPercent     // 85.0 or null
tag.productPageUrl   // "https://tigertag.io/products/..." or null
tag.apiUrl           // "https://api.tigertag.io/..." or null
```

### Creating and modifying tags

```js
// Build from scratch
const tag = TigerTag.create({
  idMaterial: 0x954B,        // PLA
  idBrand: 0x4DF9,           // Rosa3D
  color1R: 255, color1G: 0, color1B: 0, color1A: 255,
  nozzleTempMin: 195, nozzleTempMax: 230,
  dryTemp: 50, dryTime: 5,
  bedTempMin: 50, bedTempMax: 60,
  measure: 1000, measureAvailable: 1000,
  idUnit: 0x15,              // grams
  idDiameter: 0x38,          // 1.75mm
  idType: 0x8E,              // filament
  tdRaw: 230,                // HueForge TD = 23.0
  customMessage: 'Starter Red',
});

// Immutable update (protected fields: idTigertag, idProduct, uid, signatureR, signatureS)
const updated = tag.patch({ measureAvailable: 750, customMessage: 'Updated' });

// Blank Init tag (ready for programming)
const init = TigerTag.asInit();

// Erase — 80 zero bytes to wipe a chip back to blank NDEF
const blank = TigerTag.erase();
```

### Cloud sync (TigerTag+)

```js
// Fetch live manufacturer data from TigerTag+ API
const apiData = await tag.rawApi();

// Compare chip fields vs cloud API
const diffs = await tag.diffApi();
for (const d of diffs) {
  console.log(`${d.field}: chip=${d.chipValue} → api=${d.apiValue}`);
}

// Auto-apply cloud values to chip fields
const [patchedTag, changes] = await tag.patchFromApi();

// Sync reference databases (brands, materials, types…)
const updated = await tag.syncDb();
```

---

## TigerTagDB

```js
const { TigerTagDB } = require('tigertag');

const db = new TigerTagDB();          // bundled DB, offline

// Lookup by ID
const material = db.material(0x954B);
console.log(TigerTagDB.label(material));  // "PLA"

const brand = db.brand(0x4DF9);
console.log(TigerTagDB.label(brand));     // "Rosa3D"

// Sync databases from API + GitHub mirror
await db.sync();

// Custom DB path
const db2 = new TigerTagDB({ dbPath: '/path/to/db' });
```

---

## CLI

```bash
# Parse a dump file
tigertag dump.bin

# JSON output
tigertag dump.bin --json

# Raw protocol fields (no DB lookup)
tigertag dump.bin --raw

# Use a custom database folder
tigertag dump.bin --db /path/to/db

# Update reference databases and exit
tigertag --sync-only

# Show version
tigertag --version
```

---

## NFC SDK integration

```js
// Node.js — nfc-pcsc (ACR122U / PN532)
reader.on('card', async (card) => {
  const uid = Buffer.from(card.uid, 'hex');        // 7 bytes
  // Read pages 4–39 (144 bytes, user data + signature)
  const payload = await reader.read(4, 144, 4);    // startPage, length, pageSize
  const tag = TigerTag.fromPages(payload, uid);
  console.log(tag.pretty());
});
```

See [`examples/integrate_nfc_sdk.js`](examples/integrate_nfc_sdk.js) for patterns covering
Android, iOS, Flutter, Arduino, and Electron/nfc-pcsc.

---

## Electron integration

```js
// main.js — replace parseTigerTag() subprocess dependency
const { TigerTag, TigerTagDB } = require('tigertag');

// Called from your NFC reader callback
function parseTigerTag(payload, uid) {
  const tag = TigerTag.fromPages(Buffer.from(payload), Buffer.from(uid));
  const db  = new TigerTagDB();
  return {
    dict: tag.toDict(db),
    raw:  tag.toRawDict(),
    sig:  tag.verify(db).toDict(),
  };
}
```

---

## Protocol memory layout

```
Pages 0x04–0x27  (144 bytes: user data + ECDSA signature)

Offset  Size  Field
──────────────────────────────────────────────────────
0x00    4     idTigertag        u32 BE — version identifier
0x04    4     idProduct         u32 BE — 0xFFFFFFFF=Maker, 0=Init, else cloud ID
0x08    2     idMaterial        u16 BE
0x0A    1     idAspect1         u8
0x0B    1     idAspect2         u8
0x0C    1     idType            u8
0x0D    1     idDiameter        u8
0x0E    2     idBrand           u16 BE
0x10    4     color1 RGBA       u8×4
0x14    3     measure           u24 BE
0x17    1     idUnit            u8
0x18    2     nozzleTempMin     u16 BE
0x1A    2     nozzleTempMax     u16 BE
0x1C    1     dryTemp           u8
0x1D    1     dryTime           u8 hours
0x1E    1     bedTempMin        u8
0x1F    1     bedTempMax        u8
0x20    4     timestamp         u32 BE — seconds since 2000-01-01 UTC
0x24    3     color2 RGB        u8×3 + 0x00 padding
0x28    3     color3 RGB        u8×3 + 0x00 padding
0x2C    2     tdRaw             u16 BE — HueForge TD × 10
0x2E    2     (padding)
0x30    28    customMessage     UTF-8, zero-padded
0x4C    3     measureAvailable  u24 BE
0x4F    1     (padding)
── Signature (only in 144-byte payload) ──────────────
0x50    32    signatureR        ECDSA-P256 R component
0x70    32    signatureS        ECDSA-P256 S component
```

**Dump formats:**

| Size | Format |
|------|--------|
| 180 bytes | Full chip dump (pages 0–44) — UID auto-extracted |
| 144 bytes | User data + signature (pages 0x04–0x27) |
| 80 bytes  | User data only (pages 0x04–0x17) |

---

## ECDSA signature scheme

```
Signed message = SHA-256( uid_bytes(7) + id_tigertag_BE(4) + id_product_BE(4) )
Signature      = 64 bytes raw: R(32) + S(32)
Algorithm      = ECDSA-P256 (prime256v1)
Public key     = PEM in database/id_version.json[].public_key
```

Uses **Node.js built-in `crypto`** — no `node-forge`, no OpenSSL wrappers, no external dependencies.

---

## Exports

```js
const {
  TigerTag,
  TigerTagDB,
  SignatureResult,
  ApiDiff,
  syncDatabases,
  ID_TIGERTAG,
  ID_TIGERTAG_PLUS,
  ID_TIGERTAG_INIT,
  MAKER_PRODUCT_ID,
  INIT_PRODUCT_ID,
} = require('tigertag');
```

---

## Examples

| File | Description |
|------|-------------|
| [`examples/basic_parse.js`](examples/basic_parse.js) | Parse a TigerTag payload, inspect fields |
| [`examples/verify_signature.js`](examples/verify_signature.js) | Full ECDSA sign → verify round-trip |
| [`examples/integrate_nfc_sdk.js`](examples/integrate_nfc_sdk.js) | Integration patterns for all major NFC SDKs |

---

## Tests

```bash
npm test
```

75 tests across all SDK features. Uses fixtures from `test/fixtures/` — no NFC hardware needed.

To regenerate fixtures:

```bash
node scripts/generate_fixtures.js
```

---

## Requirements

- **Node.js 18+** (uses built-in `fetch` and `crypto`)
- No external runtime dependencies

---

## Related projects

| Project | Description |
|---------|-------------|
| [TigerTag Python SDK](https://github.com/TigerTag-Project/TigerTag-SDK-Python) | Python port of this SDK |
| [TigerTag RFID Guide](https://github.com/TigerTag-Project/TigerTag-RFID-Guide) | Open protocol specification |
| [TigerTag Studio Manager](https://tigertag.io) | Desktop app (Windows / macOS / Linux) |
| [Tiger Scale](https://github.com/TigerTag-Project/Tiger-Scale) | Open-source DIY smart scale (~30 €) |

---

## License

[GPL-3.0](LICENSE.md) — free for personal and commercial use under the GPL.
For OEM / commercial licensing inquiries: **licensing@tigertag.io**
