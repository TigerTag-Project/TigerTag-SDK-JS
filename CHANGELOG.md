# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.2.0] — 2026-09-30

### Added
- **Unified playground**: `tools/playground.html` is now one page, byte-for-byte identical in the
  JavaScript and Python SDKs. Each `tools/server.*` implements the same server contract
  (`docs/playground-api.md`): `GET /api/version` (now `{ version, sdk, label, repo, install,
  server, style }` — the page takes its SDK names, links and the `create()` code style from it),
  `POST /api/parse` / `/api/build` (snake_case `create()` fields, `measure_available`) /
  `/api/diff`, `GET /api/catalog/info` / `<id>`, `POST /api/catalog/refresh`, `GET /api/db/info`,
  `POST /api/db/update`, `GET /api/db/table/<file>`, `GET /api/nfc/events` (Server-Sent Events,
  chips already present replayed on connect), `POST /api/nfc/read` / `burn` / `plan`. The page
  talks to the readers through SSE + HTTP on both servers (the JS server keeps its WebSocket transport for older pages; `TIGERTAG_PLAYGROUND_NO_NFC=1` starts it without readers).
  `scripts/check_playground_sync.js` fails when the two copies differ (the local checkout next to
  this one, else GitHub `main`); the test suite runs it and skips it when neither is reachable.
  From the other SDK's page: gradient colour preview, read-only manufacturing date, refusal of an available quantity above the initial one, Studio Manager download buttons, error toasts, tables loaded from the server (`/api/db/table`).
- **Tag index / tag count** (protocol v2.2). Page 0x0D byte 3 (payload offset +39),
  previously reserved padding, is now parsed and written as `tagInfo` (u8):
  high nibble = tag index, which of the item's TigerTags this one is, from 1 (0 = unknown);
  low nibble = tag count, how many TigerTags the item carries — a filament spool, a resin
  bottle…, as given by idType (0 = unknown, 1 = single tag,
  2 = twin tag, … 15). The hex reads "index/count": `0x11` single tag, `0x12` / `0x22`
  twin tag, tag 1 / 2 of 2, `0x02` twin tag with index unknown, `0x00` unknown.
  - `tag.tagInfo`, and read-only getters `tag.tagCount` / `tag.tagIndex`.
  - `TigerTag.create({ tagCount, tagIndex })` (default `0` = unknown); `asInit()` writes `0x00`.
    Values outside 0–15 throw `RangeError`.
  - `patch()` accepts `tagInfo`, `tagCount` and `tagIndex`; `patchFromRawDict()` /
    `fromRawDict()` accept `tag_info`.
  - `validate()` warns when tag index / count are outside 0–15, when index > count (count > 0),
    and when count is 1 with index > 1.
  - `toRawDict()` gains `tag_info`; `toDict()` gains `tag_count` / `tag_index`
    (`null` when unknown) next to `twin_tag_pairing_id`; `pretty()` prints a `Tag` line
    (`Tag          1 of 2`) after `Twin tag ID`; `describe()` adds "Tag 1 of 2 on this filament."
    when known (the idType label, lowercased; "item" when the type is unknown).
  - `tagInfo` is not covered by the ECDSA signature — setting it never invalidates a signed tag.

- Playground: "Tag index" / "Tag count" inputs (0–15, 0 = unknown) passed to
  `TigerTag.create()` via `/api/build`; the client-side encoder / decoder handle byte +39;
  the decoded view shows a `Tag` row after `Twin tag ID` ("1 of 2", "? of 2", "unknown");
  the raw hex view labels page 13 byte 3 as the tag index / count (e.g. `(0x12) tag 1 of 2`);
  imported `.bin` files and scanned chips fill the two inputs; presets and API loads reset them to 0.
- Playground server: `/api/parse` and the `card:detected` WebSocket event include
  `validate` (the `validate()` warnings), shown in a new "Validation" card.
- Playground: an info bubble on "Tag index" and "Tag count" explains both values;
  the repository list points to Tiger-Scale-V3 and adds TigerSpool-RFID, TigerPOD,
  TigerSystem-Docs and TigerTag_Firebase_Integration.
- Playground ecosystem panel: photo cards for Tiger Scale V3, TigerSpool, TigerPOD Mini
  and the mobile app.
- Playground: TigerTag favicon (`assets/favicon.svg`, with `assets/apple-touch-icon.png`).
- Playground SDK Input panel: `create()` | `HEX` | `Pages` tabs. `HEX` shows exactly what
  Burn writes (144 bytes, pages 0x04–0x27, uppercase); `Pages` lists them page by page in
  write order with the Raw Read annotations (page 0x0D byte 3 → `tag 1 of 2`). Copy copies
  the active tab (`Pages` → one TSV line per page). The "→ Burn result" section is kept.
- Playground twin tag mode: when two or more readers hold a chip (sorted by name → #1, #2, …),
  Tag count is locked to the number of chips and Tag index to "auto", with a note naming
  each reader's tag ("#1 <reader> = tag 1 of 2"). Generate builds one payload per reader — same
  data, same Timestamp (computed once in the page and passed to `create()`), tag index 1…n
  (`0x12`, `0x22`) — and SDK Input shows
  one section per reader. SDK Output gets `#1` / `#2` buttons to switch between the chips.
  Burn asks for confirmation listing each reader, UID and tag, then writes each reader's own
  payload; the "x/y written" counter and the burn result aggregate across the writes.
  Loading a `.bin` or a scanned chip clears the twin plan.
- Playground server: `burn:write` accepts an optional `reader` field (a reader id / name, or an
  array of them) to write to those readers only; without it every reader holding a chip is
  written, as before (`tools/burn_targets.js`).
- Playground "Chips on the readers" card: for the chips currently on the readers, checks they
  belong to the same item (same Timestamp), carry identical data apart from byte +39, and that
  the tag numbering is complete (e.g. "Numbering complete: 1/2 + 2/2", "tag 2/2 not on a reader",
  or "Tag index / count unknown" for tags written before protocol v2.2). The server replays the
  last chip read on each reader to a newly connected page.

- Playground Read / Burn modes: a header switch "Read" (default) | "Burn".
  Read shows only what the readers read (or an imported `.bin`), under a blue "Read result"
  banner naming the reader and UID (or the file), with the "Chips on the readers" card; Burn
  is disabled and twin tag locking is off. Burn shows only what Burn will write, under an
  orange "Burn preview — not written yet" banner listing the target readers (and each one's
  tag i of n); a chip placed on a reader never replaces the preview, and Burn writes the
  stored preview, never the last payload read. Generate switches to Burn, Import .bin to Read;
  each mode keeps its last view. In Read mode, removing the chip whose result is shown switches
  to another chip still on a reader, or clears the view (an imported `.bin` stays). Reader
  events start only after the reference database has loaded.

- Playground burn never writes a signature and never leaves a stale one: `burn:write` always
  writes pages 0x04–0x27 (36 pages) — the tag data on 0x04–0x17, then `00 00 00 00` on every
  signature page 0x18–0x27, whatever the payload (TigerTag, TigerTag+, or data read back from a
  signed chip). Only a certified manufacturer can issue a signature, and a copied one would be
  invalid since it covers the chip UID; the playgrounds only read signatures to verify them.
  Pages 0–3 and 0x28+ are never touched. The page plan lives in `tools/burn_plan.js`
  (unit-tested; accepts 80 or 144 bytes); `burn:result` reports `pagesWritten: 36` and
  `signatureDropped` when the payload carried a signature. The playground sends the full
  144-byte image, the HEX / Pages tabs show all 36 pages with the zeroed signature, and the
  caption and confirmation say so ("the signature read from the chip is not copied" when the
  data came from a signed chip).

- No emoji anywhere: `SignatureResult` labels are plain words (`VALID`, `INVALID`, `NOT SIGNED`,
  `NO PUBLIC KEY — …`, `NO UID — …`, `NO CRYPTO — …`), `pretty()` prints `signed (not verified)`
  instead of a check mark, and the scripts print `OK` / `FAILED`. The playground uses small inline
  SVG icons (read, burn, raw read, upload, download, play, check, x, warning, cloud, hourglass,
  close, refresh, external link…) in buttons, banners, tabs, badges and cards, and plain words in
  tooltips, confirmation dialogs and console logs. The README, llms.txt and the SVG badges no
  longer use emoji either.

- **TigerTag+ from the official catalogue** (`src/catalog.js`): `TigerTag.fromCatalog(productId,
  { uid, tagCount, tagIndex, timestamp, db, catalog })` builds a ready-to-burn TigerTag+ from
  `id_catalog.json` (14 000+ products); `TigerTag.fromCatalogEntry(entry, options)` does it from an
  entry; `catalogEntry(productId)` returns the display metadata (title, brand, SKU, barcode, image).
  RFID_Data mapping: `data1` = diameter, `data2`/`data3` = nozzle min/max, `data4`/`data5` = dry
  temp/time, `data6`/`data7` = bed min/max, `id_aspect2` null → 0, colours 2/3 from `color_r2…b3`
  or `color_info.colors`. The catalogue (~12 MB) is not bundled: `loadCatalog({ url, cacheDir,
  maxAge, force })` downloads it on first use and caches it in the user cache folder (override:
  `TIGERTAG_CACHE_DIR`), checks for a new version once the copy is older than 1 day (`maxAge`), falls back to the cached copy when offline and fails with a clear error
  when there is none. It changes every day: `refreshCatalog()` checks for a new version now
  (conditional download with ETag / Last-Modified — an unchanged catalogue answers 304) and
  `catalogInfo()` reports `downloaded`, `count`, `fetchedAt`, `checkedAt`, `url` and `etag`.
- Playground: one "Load a TigerTag+ product" block — a single Product ID field, a source toggle
  "Offline · Catalogue" (bundled / cached catalogue, no internet) | "Online · API" (live
  api.tigertag.io data), remembered in the browser, and one Load button; both sources fill the
  form, switch to Burn and build the preview (twin tag with two readers), share one message area
  and suggest the other source when a product is not found / the API is unreachable.
- Playground: decluttered — on screen only short labels, values, buttons and status words
  ("Catalogue · 14 164 · 1 oct.", "Tables · 25 sept.", "Burn preview · not written · twin tag ·
  2 chips"); every explanation moved into info bubbles (TigerTag+ intro, data sources, catalogue
  and tables details, Read / Burn banners, HEX / Pages captions, "Chips on the readers" checks,
  field hints, twin tag readers, Init, demo presets). Bubbles are placed to stay inside their
  panel and the viewport.
- Playground: "Load from catalogue" in the TigerTag+ tab — a product ID fills the whole form from
  the catalogue, shows title, brand, SKU and image, switches to Burn and builds the preview (twin
  tag with two readers); "Update catalogue" downloads the latest version; a status line shows
  "Catalogue: 14 164 products · updated <date>" or "not downloaded yet". Server endpoints
  `GET /api/catalog/<id>`, `GET /api/catalog/info`, `POST /api/catalog/refresh`.

### Fixed
- Playground: Generate now passes an explicit Timestamp to `create()`, so the decoded view
  shows the real Twin tag ID and manufacturing date instead of `null` / 2000-01-01.
- Playground: the `create()` call shown in SDK Input is the exact call sent to `/api/build`
  (inactive color 2 / 3 slots are no longer sent while hidden from the displayed call), so
  the text shown always reproduces the bytes.

- **Reference data always available offline, kept fresh automatically**: the product catalogue
  ships in the package as `database/id_catalog.json.gz` (~1 MB, gunzipped at load; package
  1.1 MB) next to the 7 tables. `TigerTagDB` picks, per table, the newest of the downloaded copy
  in the data dir (`dataDir`, `TIGERTAG_DATA_DIR`, default: the per-user cache folder shared
  with the catalogue) and the bundled copy. `await TigerTagDB.open()` / the constructor's
  background check (`db.ready`) look for new tables at most once a day (one request to the
  TigerTag API, GitHub mirror as fallback, only the changed tables downloaded, ~5 s timeout,
  never throws). `offline: true` / `TIGERTAG_OFFLINE=1` / CLI `--offline` mean zero network
  calls; `autoUpdate: false` disables only the automatic check (`autoSync` is a deprecated
  alias). `await db.update({ force, catalog })` forces it and returns the changed files;
  `db.info()` reports where every table comes from (custom / downloaded / bundled), the last
  check, the data dir, the offline flag and the catalogue. CLI: `tigertag update [--force]
  [--catalog] [--data-dir PATH | --db PATH]`. The catalogue loader shares the data dir, the
  offline switch and the bundled `.gz` fallback, so `TigerTag.fromCatalog()` works offline.
- Playground: "Update reference tables" button with a status line ("Reference tables: 7 (n
  downloaded, n bundled) · data <date> · checked <date>"), server endpoints `GET /api/db/info`
  and `POST /api/db/update`; the catalogue status line names the bundled copy.
- Playground: Read mode shows no SDK Input panel and Burn mode no SDK Output panel at all (not
  even the fold rail) — three columns instead of four; switching mode opens the visible panel.
- Release pipeline: `scripts/sync_databases.js` also refreshes `database/id_catalog.json.gz`
  (only when its content changed); the daily `sync-databases.yml` commits it and `publish.yml`
  runs the sync (then the tests) before `npm publish`, so every release ships the day's data.

### Changed
- Protocol version is now **TigerTag Open Source v2.2** (backward compatible: tags written
  before v2.2 read `0x00` = unknown).
- `toBytes()` writes `tagInfo` at +39 instead of a hard-coded `0x00`.
- **Behaviour change**: a custom `dbPath` is used exclusively — a missing table file now throws
  a clear error instead of silently falling back to the bundled copy; `new TigerTagDB()` now
  checks for updates once a day in the background (into the data dir — never into the package
  folder; disable with `autoUpdate: false` or `offline: true`); `db.sync()` is an alias of
  `db.update()`, and `tag.syncDb()` / `tigertag --sync-only` without a folder update the data dir
  instead of rewriting the bundled `database/` folder.

## [1.1.0] — 2026-07-10

### Changed
- **License changed from GPLv3 to Apache-2.0.** The TigerTag protocol
  specification is now published as an open standard: CC-BY-4.0 for the
  specification, CC0-1.0 for the reference database, Apache-2.0 for code, with an
  irrevocable, worldwide, royalty-free right to implement it in any product, open
  source or proprietary. Apache-2.0 carries an express patent grant.
  See <https://github.com/TigerTag-Project/TigerTag-RFID-Guide/blob/main/LICENSING.md>.

### Fixed
- `package-lock.json` was left at `1.0.1` while `package.json` declared `1.0.6`.

> Versions published to npm up to and including `1.0.6` remain under GPLv3.
> This change applies from `1.1.0` onward.

## [1.0.6] — 2026-05-22

### Fixed
- `toRawDict()` — `color_r2/g2/b2` and `color_r3/g3/b3` are forced to `0` when
  `num_colors < 2/3`. Consumers always receive clean, zero-padded values for inactive
  color slots; EEPROM garbage from the chip can never leak through to callers of
  `toRawDict()`.
- Playground `SDK Input` — `color2R/G/B` and `color3R/G/B` are omitted from the
  `TigerTag.create()` call when the aspect indicates fewer than 2 or 3 active colors.
  The SDK's natural default of `0` handles the zeroing; no spurious color bytes are
  passed.
- `_baseUnitFields()` — unrecognised `id_unit` values now return
  `{ measure_gr: 0, measure_available_gr: 0 }` instead of `{}`. Consumers always receive a
  defined, zero-safe value; chips with corrupt or unknown units no longer propagate garbage
  weight values.

### Added
- `create()` now validates required fields and throws a descriptive `Error` listing every
  missing field: `idMaterial`, `idAspect1`, `idType`, `idBrand`, `color1R`, `color1G`,
  `color1B`, `color1A`, `measure`, `idUnit`. Validation checks **presence only** — any value
  including `0` is accepted once the field is explicitly provided.
- `toRawDict()` exposes two new fields derived from the aspect DB:
  - `num_colors` — number of active color slots (1 for Basic/Silk/etc., 2 for Bicolor, 3 for
    Tricolor/Rainbow). Aspect 2 is checked first; falls back to Aspect 1.
  - `color_list` — `string[]` of `#RRGGBB` hex strings, one per active slot only. Consumers
    no longer need to filter inactive slots themselves.

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
- Playground: **Raw Hex Reader** (`Raw Read` button) — reads all 144 bytes (pages 4–39) from
  every connected reader that holds a card and displays them in a structured table: page number,
  byte offset, four individual hex bytes (B0–B3), big-endian u32 decimal, and field label. The
  signature pages (24–39) are visually dimmed and preceded by a separator row.
  - Uses the new `read:request` / `read:result` / `read:done` WebSocket protocol.
  - Supports **multiple readers simultaneously**: each reader gets its own collapsible panel,
    displayed side-by-side (flex row). Panels use the same rail UX as SDK Input / Output.
  - **Copy hex** button per panel — copies one line per page (`0x04 B0 B1 B2 B3`) to the clipboard.
    Includes page hex prefix on each line for direct cross-reference with NFC documentation.
    Button shows `Copied` (green, 1.5 s) after a successful copy so the user gets clear feedback.
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
- Playground: **Burn** button (`Burn`) — writes the generated payload to every
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
