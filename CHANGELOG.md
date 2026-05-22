# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.5] — 2026-05-22

### Added
- `TigerTag._baseUnitFields()` — static helper that converts `measure` / `measureAvailable`
  to their canonical base unit and returns convenience fields (all 11 unit IDs covered):
  - **Weight** (mg / g / kg → grams): `measure_gr` + `measure_available_gr`
  - **Volume** (ml / cl / L / m³ → millilitres): `measure_ml` + `measure_available_ml`
  - **Size** (mm / cm / m → millimetres): `measure_mm` + `measure_available_mm`
  - **Area** (m² → square millimetres): `measure_mm2` + `measure_available_mm2`
- `toRawDict()` now includes the convenience fields immediately after `measure_available`.
  Developers read a single field in grams (or ml/mm/mm²) without caring about `id_unit`.
- `toDict()` `.measure` block now includes the same convenience fields alongside `initial`,
  `available`, `unit`, and `percent`.
- `pretty()` Quantity section appends `(= 750 g)` hint on Initial and Available lines when
  the stored unit is not already the canonical base unit (g / ml / mm).
- `describe()` Quantity sentence appends `— 750 g available, 1000 g total` when applicable.

## [1.0.4] — 2026-05-22

### Added
- `tools/server.js`: `POST /api/build` endpoint — accepts `TigerTag.create()` camelCase kwargs as
  JSON body, calls `TigerTag.create(kwargs).toBytes(false)` server-side, returns
  `{ payload: "<80-byte hex>" }`. Makes the SDK the authoritative serializer for chip payload
  generation; the browser never computes chip bytes itself.
- Playground: **Available qty auto-link** — the Available Qty field automatically mirrors Initial
  Qty until the user manually edits it. Link is restored on preset load, API fetch, or NFC scan.
  Removes the old "(0 = same as initial)" convention.
- Playground: **Raw Hex Reader** (`🔬 Raw Read` button) — reads all 144 bytes (pages 4–39) from
  every connected reader that holds a card and displays them in a structured table: page number,
  byte offset, four individual hex bytes (B0–B3), big-endian u32 decimal, and field label. The
  signature pages (24–39) are visually dimmed and preceded by a separator row.
  - Uses the new `read:request` / `read:result` / `read:done` WebSocket protocol.
  - Supports **multiple readers simultaneously**: each reader gets its own collapsible panel,
    displayed side-by-side (flex row). Panels use the same rail UX as SDK Input / Output.
  - **Copy hex** button per panel — copies one line per page (`0x04 B0 B1 B2 B3`) to the clipboard.
    Includes page hex prefix on each line for direct cross-reference with NFC documentation.
    Button shows `✓ Copied!` (green, 1.5 s) after a successful copy so the user gets clear feedback.
  - **Annotated Field column** — each field cell now shows decoded values inline:
    `(value) field_name · (value) field_name · …`. Values are read directly from the raw bytes
    (no extra server round-trip). customMessage pages show the decoded ASCII chars `("azer")`.
    Signature pages remain static (raw bytes only). Implemented via `_buildFieldLabel(page, chunk)`.
  - **Page Hex column** — new "Hex" column between Page (decimal) and Offset (byte offset) shows
    the page address in hex (`0x04`, `0x05`, …, `0x27`) for quick cross-reference with the spec.
  - Hex table uses `<table>` with `table-layout:fixed` and `<colgroup>` for pixel-perfect column
    alignment guaranteed by the browser layout engine (no character-padding hacks).
  - Font stack: JetBrains Mono → Fira Code → Cascadia Code → SF Mono → system monospace — same
    terminal-grade font as shell hex viewers.
- `tools/server.js`: `read:request` WebSocket message type — broadcasts `read:result` per reader
  (uid, hex payload, byte count) then `read:done` when all readers have been polled. Tries 144 bytes
  first, falls back to 80 bytes for smaller chips.

### Fixed
- `TigerTag.create()`: new optional `measureAvailable` parameter — previously partial spools were
  silently encoded as full (defaulted to `measure`). Passing `measureAvailable` now encodes the
  actual remaining quantity correctly. Omitting it preserves the previous default behaviour
  (`measure`, i.e. full spool).
- Playground: payload generation now always goes through `POST /api/build` (SDK on the server);
  the browser no longer computes the binary chip format itself.
- Playground: binary garbage in the chip's `customMessage` field (invalid UTF-8, non-printable
  bytes) is silently discarded when populating the form — prevents garbage re-encoding on rewrite.

### Changed
- Playground: `timestamp` is always `null` in `TigerTag.create()` calls — the SDK sets its own
  write-time timestamp automatically.
- Playground: manufacturing date form field removed (timestamp is now always set by the SDK at
  write time).

## [1.0.3] — 2026-05-21

### Added
- `tag.imgUrls` getter — returns CDN image URLs for all 7 size variants
  (`icon16`, `icon32`, `thumbnail`, `small`, `medium`, `large`, `original`).
  Works for TigerTag+ chips only (filament / resin types). Cache-busted with
  `v=<timestamp>` on each call. `toRawDict()` and `toDict()` now include an
  `img` field exposing all URLs.
- Playground: **Burn** button (`🔥 Burn`) — writes the generated payload to every
  connected ACR122U / PC-SC reader that currently holds a card. Writes 20 pages
  (pages 4–23, 80 bytes) sequentially via `reader.write()`. Result reported per
  reader via WS (`burn:result`) with success/error detail; `burn:done` signals
  completion.
- Playground: **SDK Input panel** — new collapsible panel showing the exact
  `TigerTag.create({...})` call for the current tag (write flow). Symmetric to
  the SDK Output panel (same rail style, same collapse direction). Opens
  automatically when Burn is clicked; closes when Generate / NFC scan / Import
  opens SDK Output. Includes a Copy button.
- Playground: **dynamic SDK version badge** — fetches `GET /api/version` from
  the dev server and displays the real `package.json` version instead of a
  hardcoded string.
- `tools/server.js`: `GET /api/version` endpoint — returns `{ version: string }`
  from `package.json`. Used by the playground badge.
- Playground: `Generate & Preview` button is now pinned to the bottom of the
  sidebar and never scrolls out of view regardless of form length.

### Fixed
- `TigerTag.fromCloudDoc()`: TD (HueForge Transmission Distance) was stored as a
  float in Firestore (e.g. `1.5`) but was being passed directly as `tdRaw` to the
  chip, producing wrong values. Now correctly converts: `tdRaw = Math.round(doc.TD × 10)`.
  Reading is unchanged: `tag.tdValue = tag.tdRaw / 10` remains transparent.

### Changed
- Playground: 4-column layout — sidebar | center | **SDK Input** | **SDK Output**
  (previously 3-column: sidebar | center | SDK). Both SDK panels are collapsible
  with adjacent rails that touch when either or both are closed.
- Playground: SDK Output toggle label renamed from "SDK" to "SDK Output".
- Playground: smart panel state on action — Generate / NFC scan / Import opens
  SDK Output and closes SDK Input; Burn opens SDK Input and closes SDK Output.

## [1.0.2] — 2026-05-21

### Added
- `TigerTag.fromCloudDoc(doc, db?)` — build a tag from a Firestore cloud document;
  maps `data1`–`data7` (diameter, nozzle, bed, drying), `TD`, and
  `weight_available` / `measure_gr` to their chip fields. Primary entry point
  for the cloud → chip write pipeline.
- `TigerTag.fromRawDict(raw, db?)` — reconstruct a tag from a `toRawDict()` snapshot
  (snake_case); useful for write round-trips and persistent storage.
- `tag.patchFromRawDict(raw)` — surgical immutable update using snake_case keys
  (same shape as `toRawDict()`); mirrors `tag.patch()` for callers that store or
  receive snake_case dicts.
- `TigerTag._rawDictToPatchKwargs(raw)` — static helper that maps a partial
  snake_case dict to the camelCase kwargs accepted by `patch()`.

## [1.0.1] — 2026-05-20

### Added
- Playground: live ACR122U / PC-SC reader integration via WebSocket
  - Up to 2 simultaneous USB readers supported
  - Card placement auto-populates playground form and displays full SDK output
  - Reader status bar in playground header (green dot / orange pulse)
  - WebSocket server on same port as HTTP (no extra port needed)
  - Graceful fallback: playground works normally without `ws` and `nfc-pcsc`
- `tools/server.js`: WebSocket server attached to HTTP server; nfc-pcsc reader loop
  broadcasting `card:detected`, `card:removed`, `reader:connected`, `reader:disconnected`
- README: full parity with Python SDK — input format tables, key methods/properties,
  CRUD operations, ApiDiff docs, signature status table, DB auto-update table,
  chip_layout.svg diagram, ACR122U full example, ecosystem table,
  community integrations, AI-CONTEXT block
- `llms.txt`: added npm URL, install command, playground section with ACR122U details

### Changed
- `package.json`: `ws ^8.x` and `nfc-pcsc ^0.8.x` added as devDependencies
- Published to npm: `npm install tigertag` now available globally

## [1.0.0] — 2026-05-20

### Added
- `TigerTag.fromPages(uid, payload)` — primary constructor for NFC SDK integration
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
