# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] — 2026-05-20

### Added
- `TigerTag.fromPages(payload, uid)` — primary constructor for NFC SDK integration
- `TigerTag.fromDump(data)` — constructor for binary dumps (180B auto-extracts UID)
- `TigerTag.fromFile(path)` — convenience constructor from .bin file
- `TigerTag.create({ ...fields })` — build a new tag from scratch with all fields
- `TigerTag.asInit(uid)` — create a blank TigerTag Init chip ready for programming
- `TigerTag.erase()` — return 80 zero bytes to wipe a chip back to blank NDEF
- `tag.patch({ ...fields })` — immutable surgical field update, signature-safe (protected: idTigertag, idProduct, uid, signatureR/S)
- `tag.patchFromApi()` — auto-apply cloud API values to chip fields; returns patched tag + applied diffs
- `tag.diffApi()` — compare all chip fields vs TigerTag+ cloud API; covers nozzle, bed, drying, type, material, brand, diameter, aspects, colors, quantity, unit
- `tag.rawApi()` — fetch live TigerTag+ cloud product data (uses built-in fetch, Node 18+)
- `tag.verify()` — autonomous ECDSA-P256 signature verification using Node.js built-in `crypto`
- `tag.toDict()` — fully resolved object (all IDs replaced by labels + metadata)
- `tag.toRawDict()` — raw protocol fields, no resolution
- `tag.pretty()` — human-readable summary
- `tag.describe()` — natural-language paragraph for LLM prompt injection
- `tag.validate()` — field-level sanity checks
- `tag.syncDb()` — download or update reference databases
- `TigerTagDB` — loads bundled reference JSONs, auto-updates from API or GitHub
- `syncDatabases()` — standalone database sync with API + GitHub fallback
- `SignatureResult` — result of ECDSA verification with status constants
- `ApiDiff` — (field, chipValue, apiValue) — exported from main package
- `ID_TIGERTAG`, `ID_TIGERTAG_PLUS`, `ID_TIGERTAG_INIT`, `MAKER_PRODUCT_ID`, `INIT_PRODUCT_ID` — exported constants
- CLI: `tigertag dump.bin` and `node -e "require('tigertag')"`
- Bundled reference databases (offline use, no network required on first run)
- Compatible with NTAG213, NTAG215, NTAG216 and ISO 14443 compatible chips
- No external runtime dependencies — Node.js built-in `crypto` and `fetch` only
- Material identification support: filament, resin (extensible to any material type)
