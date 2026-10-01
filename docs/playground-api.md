# TigerTag playground — server contract

The TigerTag playground is **one page**, `tools/playground.html`, byte-for-byte identical in
the JavaScript SDK ([TigerTag-SDK-JS](https://github.com/TigerTag-Project/TigerTag-SDK-JS)) and the
Python SDK ([TigerTag-SDK-Python](https://github.com/TigerTag-Project/TigerTag-SDK-Python)).
Each repository ships a small server that implements the contract below with its own SDK:

| SDK | Start | Reader support |
|---|---|---|
| JavaScript | `node tools/server.js [port]` | `npm install ws nfc-pcsc` |
| Python | `python3 tools/server.py [port]` | `pip install "tigertag[nfc]"` (pyscard) |

Then open `http://localhost:<port>/tools/playground.html` (default port 7432).
`TIGERTAG_PLAYGROUND_NO_NFC=1` starts either server without touching the readers.

All request and response bodies are JSON with **snake_case** keys, except the NFC message
fields `reqId` and `pagesWritten` (kept for compatibility). Hex strings are lowercase in
responses and accepted in any case in requests. Servers may add extra keys; the page only
relies on the keys listed here. Errors are `{ "error": "<message>" }` with a 4xx / 5xx status.

The page must never contain SDK-specific code: everything that differs comes from
`GET /api/version`.

## SDK identity

### `GET /api/version`

```json
{ "version": "1.2.0", "sdk": "javascript", "label": "JS SDK",
  "repo": "https://github.com/TigerTag-Project/TigerTag-SDK-JS",
  "install": "npm install tigertag", "server": "node tools/server.js", "style": "camel" }
```

| Key | JavaScript | Python |
|---|---|---|
| `sdk` | `javascript` | `python` |
| `label` | `JS SDK` | `Python SDK` |
| `repo` | `…/TigerTag-SDK-JS` | `…/TigerTag-SDK-Python` |
| `install` | `npm install tigertag` | `pip install tigertag` |
| `server` | `node tools/server.js` | `python3 tools/server.py` |
| `style` | `camel` (`toRawDict()`, `create({ tagCount })`) | `snake` (`to_raw_dict()`, `create(tag_count=…)`) |

The page uses it for the header link and badge, the SDK highlighted in the GitHub list, the
`create()` code shown in SDK Input, the method names in the SDK Output tabs and every hint
that names the SDK or its server.

## Tags

### `POST /api/parse`

Request: `{ "uid": "<14 hex>"?, "payload": "<hex: 80, 144 or 180 bytes>" }` — without a UID the
payload is parsed as a dump (`fromDump()` / `from_dump()`).

Response:

| Key | Content |
|---|---|
| `pretty`, `describe` | `pretty()` / `describe()` text |
| `verify` | signature result `{ ok, status, detail }` |
| `raw_dict`, `dict` | `toRawDict()` / `to_raw_dict()`, `toDict()` / `to_dict()` |
| `validate` | list of warnings |
| `tag_info`, `tag_count`, `tag_index` | byte +39 and its two nibbles (`null` when 0) |

### `POST /api/build`

Request: the keyword arguments of `TigerTag.create()` in snake_case — `product_id`,
`id_material`, `id_aspect_1`, `id_aspect_2`, `id_type`, `id_diameter`, `id_brand`,
`color1_r/g/b/a`, `color2_r/g/b`, `color3_r/g/b`, `measure`, `id_unit`, `nozzle_temp_min/max`,
`dry_temp`, `dry_time`, `bed_temp_min/max`, `timestamp`, `custom_message`, `td_raw`,
`tag_count`, `tag_index` — plus `uid` (hex) and `measure_available` (when it differs from
`measure`).

Response: `{ "payload": "<80-byte hex>", "validate": [...], "tag_info", "tag_count", "tag_index" }`.
Both SDKs produce the same bytes for the same fields.

### `POST /api/diff`

Request: `{ "uid"?, "payload" }`. Response:
`{ "api_data": <raw_api() JSON or null>, "diffs": [{ "field", "chip_value", "api_value" }], "in_sync": bool, "error": "<message or null>" }`.

## TigerTag+ catalogue

### `GET /api/catalog/info`

The catalogue copy in use: `{ "downloaded", "source": "bundled" | "downloaded", "count",
"fetched_at", "checked_at", "url", "etag", "last_modified", "path", "bundled": { "path", "date" } }`.

### `GET /api/catalog/<id>`

A ready-to-burn TigerTag+:
`{ "entry": { id, title, brand, sku, barcode, img_src, material, measure, product_type, color, color_info },
"rfid_data", "fields": <create() keyword arguments, snake_case>, "raw_dict", "payload": "<80-byte hex>",
"pretty", "describe", "catalog": <catalog info> }`.
Errors: 400 (not a number), 404 (not in the catalogue), 422 (no RFID data), 503 (no copy at all).

### `POST /api/catalog/refresh`

Checks for a new catalogue now (conditional download). Response: the catalog info;
503 `{ error, ...info }` when offline.

## Reference tables

### `GET /api/db/info`

`{ "custom", "db_path", "data_dir", "offline", "auto_update", "max_age" (seconds), "last_check",
"last_error", "tables": { "id_material.json": { "source": "bundled" | "downloaded" | "custom",
"path", "timestamp" }, … }, "catalog": <catalog info> }`.

### `POST /api/db/update`

Request: `{ "force"?: bool, "catalog"?: bool }`. Response: `{ "changed": [files], "info": <db info> }`;
503 `{ error, info }` when offline or unreachable.

### `GET /api/db/table/<file>`

The table in use (e.g. `id_material.json`), as served to the page; header
`X-TigerTag-Source: bundled | downloaded | custom`. 404 for an unknown file.

## NFC readers

### `GET /api/nfc/events` — Server-Sent Events

Each event is `data: <JSON>\n\n`; `: keep-alive` comments every 15 s. On connect the server
sends `readers:status`, then one `card:detected` per chip already on a reader.

| `type` | Fields |
|---|---|
| `readers:status` | `readers: [{ id, name, connected, hasCard, uid }]`, `nfc` (reader support installed), `hint` (how to install it, or null), `error` |
| `reader:connected` / `reader:disconnected` | `reader: { id, name }` |
| `card:detected` | `reader`, `uid`, `payload` (hex, 144 bytes, 80 on small chips) and the `/api/parse` keys (`pretty`, `describe`, `verify`, `raw_dict`, `dict`, `validate`, `tag_info`, `tag_count`, `tag_index`) |
| `card:removed` | `reader` |
| `error` | `reader`, `message` |

### `POST /api/nfc/read`

Request: `{ "reqId"?, "reader"? }` (reader id / name; all readers holding a chip when omitted).
Response: `{ "messages": [ { "type": "read:result", reqId, reader, uid, payload, bytes, ok, error? }…,
{ "type": "read:done", reqId } ] }`.

### `POST /api/nfc/burn`

Request: `{ "reqId"?, "reader"?, "payload": "<hex, 80 or 144 bytes>" }`. Writes pages 0x04–0x27
(36 pages, one UPDATE BINARY per page) of every reader holding a chip, or only `reader`.
**The signature pages 0x18–0x27 are always written as `00`** — a playground never writes a
signature (only a certified manufacturer can issue one, and a copied signature is invalid since
it covers the chip UID). Pages 0–3 and 0x28+ are never touched.
Response: `{ "messages": [ { "type": "burn:result", reqId, reader, uid, ok, pagesWritten: 36,
signature_dropped, error? }…, { "type": "burn:done", reqId } ] }`; 400 for a bad length.

### `POST /api/nfc/plan`

Dry run, no reader touched. Request: `{ "payload" }`. Response:
`{ "signature_dropped": bool, "pages": 36, "apdus": ["FF D6 00 04 04 BC 0F CB 97", …] }`.

## Keeping the two copies in sync

`tools/playground.html` must stay identical in both repositories.
`scripts/check_playground_sync.js` (JavaScript) and `scripts/check_playground_sync.py`
(Python) compare it with the sibling repository's copy — the local checkout next to this one
when present, otherwise the other repository's `main` on GitHub — and fail on any difference.
Both test suites run the check and skip it when neither copy is reachable.
