'use strict';

// SPDX-License-Identifier: Apache-2.0
//
// TigerTag SDK
// Copyright (c) 2025-2026 TigerTag Corp.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Implementing the TigerTag protocol requires no licence and no payment.
// https://github.com/TigerTag-Project/TigerTag-RFID-Guide/blob/main/LICENSING.md

/**
 * TigerTag reference tables (id_*.json): loader, precedence, automatic and
 * manual updates.
 *
 * Where each table comes from (per file):
 *   1. a custom folder (`dbPath`) — used EXCLUSIVELY: a missing file is an error,
 *      there is no fallback, and no network call happens unless update() is called;
 *   2. otherwise the newest of
 *        - the downloaded copy in the data dir (`dataDir`, `TIGERTAG_DATA_DIR`,
 *          default: the per-user cache folder shared with the catalogue), and
 *        - the copy bundled in the npm package (always present),
 *      compared by their last_update.json timestamps.
 *
 * Updates: `new TigerTagDB()` never waits for the network. With autoUpdate on
 * (default) it starts ONE background check per process, at most once per
 * `maxAge` (default 1 day): one request to the TigerTag API (GitHub mirror as
 * fallback), only the changed tables are downloaded into the data dir, ~5 s
 * timeout, errors are swallowed. `await TigerTagDB.open()` does the same check
 * before returning. `await db.update()` forces it. `offline: true` (or
 * `TIGERTAG_OFFLINE=1`) means zero network calls.
 */

const fs   = require('fs');
const path = require('path');
const { defaultDataDir, resolveOffline, BUNDLED_DIR } = require('./datadir');

const _API_BASE        = 'https://api.tigertag.io/api:tigertag';
const _GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/TigerTag-Project/TigerTag-RFID-Guide/main/database';
const _MANUAL_TIMEOUT  = 30000;
const _AUTO_TIMEOUT    = 5000;
const _RETRY_AFTER_FAILURE_MS = 3600 * 1000;   // a failed automatic check is retried after 1 h

/** Default interval between two automatic checks: 1 day. */
const DEFAULT_UPDATE_MAX_AGE_MS = 24 * 3600 * 1000;

const _LAST_UPDATE = 'last_update.json';
const _STATE_FILE  = 'db_state.json';

// Maps last_update key → [API endpoint, local filename]
const _DATASETS = {
  versions:           ['version/get/all',           'id_version.json'],
  types:              ['type/get/all',              'id_type.json'],
  brands:             ['brand/get/all',             'id_brand.json'],
  filament_diameters: ['diameter/filament/get/all', 'id_diameter.json'],
  filament_materials: ['material/get/all',          'id_material.json'],
  aspects:            ['aspect/get/all',            'id_aspect.json'],
  measure_units:      ['measure_unit/get/all',      'id_measure_unit.json'],
};

// Instance property holding each table
const _PROPS = {
  versions: '_versions', types: '_types', brands: '_brands', filament_diameters: '_diameters',
  filament_materials: '_materials', aspects: '_aspects', measure_units: '_units',
};

const _BUNDLED_DB_PATH = BUNDLED_DIR;
const _backgroundChecks = new Map();   // dataDir → Promise (one automatic check per process)

function _readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function _writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

async function _getJson(url, fetchImpl, timeout) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('fetch() is not available (Node.js 18+ required)');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const resp = await f(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return JSON.parse(await resp.text());
  } finally {
    clearTimeout(timer);
  }
}

// One request for every table timestamp: TigerTag API first, GitHub mirror as fallback
async function _remoteLastUpdate(fetchImpl, timeout, log) {
  try {
    const data = await _getJson(`${_API_BASE}/all/last_update`, fetchImpl, timeout);
    log('[info] source: api');
    return { data, source: 'api', url: (endpoint) => `${_API_BASE}/${endpoint}` };
  } catch (exc) {
    log(`[warn] TigerTag API unreachable (${exc.message}), falling back to GitHub mirror`);
    try {
      const data = await _getJson(`${_GITHUB_RAW_BASE}/${_LAST_UPDATE}`, fetchImpl, timeout);
      log('[info] source: github');
      return { data, source: 'github', url: (_endpoint, filename) => `${_GITHUB_RAW_BASE}/${filename}` };
    } catch (exc2) {
      throw new Error(
        `Both API and GitHub mirror are unreachable.\nAPI error: ${exc.message}\n`
        + `GitHub error: ${exc2.message}\nCheck your internet connection.`,
      );
    }
  }
}

/**
 * Download the changed tables into `dir`.
 * `current(key, localLastUpdate)` gives the timestamp already available locally
 * (null = nothing), a table is downloaded when the remote one is newer (or `force`).
 * Returns the list of written files (last_update.json included when rewritten).
 */
async function _updateTables(dir, { force = false, fetchImpl = null, timeout = _MANUAL_TIMEOUT, log = () => {}, current }) {
  const remote = await _remoteLastUpdate(fetchImpl, timeout, log);
  const lastUpdateFile = path.join(dir, _LAST_UPDATE);
  const local = _readJson(lastUpdateFile) || {};
  const updated = [];
  for (const [key, [endpoint, filename]] of Object.entries(_DATASETS)) {
    const remoteTs = remote.data[key];
    if (remoteTs == null) { log(`[skip] ${key}: not in last_update payload`); continue; }
    const have = current(key, local);
    if (!force && have != null && have >= remoteTs) { log(`[ok]   ${filename}: up to date`); continue; }
    log(`[sync] ${filename}: ${have} → ${remoteTs}`);
    const data = await _getJson(remote.url(endpoint, filename), fetchImpl, timeout);
    if (!Array.isArray(data)) throw new Error(`${filename}: expected a JSON list`);
    _writeJson(path.join(dir, filename), data);
    local[key] = remoteTs;
    updated.push(filename);
  }
  if (updated.length) {
    _writeJson(lastUpdateFile, local);
    updated.push(_LAST_UPDATE);
  }
  return { updated, source: remote.source };
}

/**
 * Download or update the reference tables in one folder (e.g. a custom dbPath).
 * Tries the live TigerTag API first; falls back to the GitHub mirror.
 * Only downloads files whose timestamp has changed.
 *
 * @param {string} [dbPath] - Folder where JSON files are stored (created if missing).
 *                            Default: the data dir (see TigerTagDB).
 * @param {object} [options]
 * @param {boolean}  [options.force=false]   - Re-download all files even if up to date.
 * @param {boolean}  [options.verbose=true]  - Print progress to stdout.
 * @param {number}   [options.timeout=30000] - Per-request timeout in ms.
 * @param {Function} [options.fetch]         - fetch implementation (default: global fetch).
 * @returns {Promise<string[]>} List of filenames that were downloaded/updated.
 * @throws {Error} When both the API and the GitHub mirror are unreachable.
 */
async function syncDatabases(dbPath, { force = false, verbose = true, timeout = _MANUAL_TIMEOUT, fetch = null } = {}) {
  const dir = path.resolve(dbPath || defaultDataDir());
  fs.mkdirSync(dir, { recursive: true });
  const log = verbose ? (msg) => console.log(msg) : () => {};
  const { updated } = await _updateTables(dir, {
    force, fetchImpl: fetch, timeout, log,
    current: (key, local) => (fs.existsSync(path.join(dir, _DATASETS[key][1])) ? (local[key] ?? null) : null),
  });
  return updated;
}

/**
 * Loads and exposes TigerTag JSON reference databases.
 *
 * Ships with bundled JSON files so the SDK works offline immediately after install,
 * keeps a fresher downloaded copy in the data dir, and checks for updates once a day.
 *
 * All ID lookups return the full JSON entry object (or null if not found).
 * The JSON files are the single source of truth — no hardcoded ID mappings.
 *
 * @example
 * const db = new TigerTagDB();                    // local data, background daily check
 * const db = await TigerTagDB.open();             // waits for the daily check (5 s max)
 * const db = new TigerTagDB({ offline: true });   // never touches the network
 * const mat = db.material(38219);
 * console.log(mat.label);   // "PLA"
 */
class TigerTagDB {
  /**
   * Synchronous and network-free: loads the freshest LOCAL copy of every table.
   * With autoUpdate on, a background daily check is started (see `ready`).
   *
   * @param {object} [options]
   * @param {string}   [options.dbPath]          - Custom folder, used exclusively (missing file → Error,
   *                                               no fallback, no automatic network call).
   * @param {string}   [options.dataDir]         - Folder for downloaded copies (default: TIGERTAG_DATA_DIR,
   *                                               TIGERTAG_CACHE_DIR, or the per-user cache folder).
   * @param {boolean}  [options.offline]         - true = zero network calls (default: TIGERTAG_OFFLINE env).
   * @param {boolean}  [options.autoUpdate=true] - Automatic daily check (background in the constructor).
   * @param {boolean}  [options.autoSync]        - Deprecated alias of autoUpdate.
   * @param {number}   [options.maxAge=1 day]    - Minimum interval between two automatic checks, in ms.
   * @param {boolean}  [options.verbose=false]   - Log update progress / errors.
   * @param {Function} [options.fetch]           - fetch implementation (default: global fetch).
   * @throws {Error} When a custom dbPath is missing a table or a table cannot be parsed.
   */
  constructor({
    dbPath, dataDir, offline, autoUpdate, autoSync, maxAge = DEFAULT_UPDATE_MAX_AGE_MS,
    verbose = false, fetch = null,
  } = {}) {
    this._custom     = dbPath ? path.resolve(dbPath) : null;
    this._path       = this._custom || _BUNDLED_DB_PATH;   // kept for backward compatibility
    this._dataDir    = path.resolve(dataDir || defaultDataDir());
    this._offline    = resolveOffline(offline);
    this._autoUpdate = autoUpdate ?? autoSync ?? true;
    this._maxAge     = maxAge;
    this._verbose    = verbose;
    this._fetch      = fetch;
    this._reloadAll();
    /** Resolves (to this instance) when the background check started by the constructor is done. */
    this.ready = Promise.resolve(this);
    if (this._autoUpdate && this._canAutoUpdate()) {
      let p = _backgroundChecks.get(this._dataDir);
      if (!p) {
        p = this._autoCheck();
        _backgroundChecks.set(this._dataDir, p);
      }
      this.ready = p.then(() => { this._reloadAll(); return this; }, () => this);
    }
  }

  /**
   * Create a TigerTagDB and wait for the automatic daily check (at most once per
   * maxAge, ~5 s timeout, never throws) before returning it.
   *
   * @param {object} [options] - Same options as the constructor.
   * @returns {Promise<TigerTagDB>}
   */
  static async open(options = {}) {
    const db = new TigerTagDB({ ...options, autoUpdate: false });
    db._autoUpdate = options.autoUpdate ?? options.autoSync ?? true;
    if (db._autoUpdate && db._canAutoUpdate()) {
      await db._autoCheck();
      db._reloadAll();
    }
    return db;
  }

  _canAutoUpdate() { return !this._offline && !this._custom; }

  _log(msg) { if (this._verbose) console.log(msg); }

  // Timestamp already available locally for a table (newest of data dir and bundled copy)
  _currentTs(key, dataLastUpdate) {
    const bundled = (_readJson(path.join(_BUNDLED_DB_PATH, _LAST_UPDATE)) || {})[key] ?? null;
    const file = path.join(this._dataDir, _DATASETS[key][1]);
    const dl = fs.existsSync(file) ? (dataLastUpdate[key] ?? null) : null;
    if (dl == null) return bundled;
    if (bundled == null) return dl;
    return Math.max(dl, bundled);
  }

  _state() { return _readJson(path.join(this._dataDir, _STATE_FILE)) || {}; }

  _saveState(patch) {
    try { _writeJson(path.join(this._dataDir, _STATE_FILE), { ...this._state(), ...patch }); } catch { /* read-only */ }
  }

  // Automatic check: throttled by maxAge (1 h after a failure), never throws
  async _autoCheck() {
    const st = _readJson(path.join(this._dataDir, _STATE_FILE)) || {};
    const now = Date.now();
    if (st.lastCheck && now - Date.parse(st.lastCheck) < this._maxAge) return [];
    if (st.lastAttempt && st.lastError && now - Date.parse(st.lastAttempt) < Math.min(this._maxAge, _RETRY_AFTER_FAILURE_MS)) return [];
    const at = new Date().toISOString();
    try {
      const { updated, source } = await _updateTables(this._dataDir, {
        fetchImpl: this._fetch, timeout: _AUTO_TIMEOUT, log: (m) => this._log(m),
        current: (key, local) => this._currentTs(key, local),
      });
      this._saveState({ lastCheck: at, lastAttempt: at, lastError: null, source, lastUpdated: updated });
      return updated;
    } catch (err) {
      this._log(`[warn] automatic reference data check failed: ${err.message}`);
      this._saveState({ lastAttempt: at, lastError: err.message });
      return [];
    }
  }

  /**
   * Check for new reference tables now and download the changed ones.
   * Targets the custom dbPath when one is set, otherwise the data dir.
   *
   * @param {object}  [options]
   * @param {boolean} [options.force=false]   - Re-download every table even if up to date.
   * @param {boolean} [options.catalog=false] - Also check for a new product catalogue.
   * @param {number}  [options.timeout=30000] - Per-request timeout in ms.
   * @returns {Promise<string[]>} Files written (tables, last_update.json, id_catalog.json).
   * @throws {Error} When offline, or when the API and the GitHub mirror are both unreachable.
   */
  async update({ force = false, catalog = false, timeout = _MANUAL_TIMEOUT } = {}) {
    if (this._offline) {
      throw new Error('TigerTagDB is offline (offline: true or TIGERTAG_OFFLINE=1): update() makes no network call.');
    }
    const dir = this._custom || this._dataDir;
    const at = new Date().toISOString();
    const { updated, source } = await _updateTables(dir, {
      force, fetchImpl: this._fetch, timeout, log: (m) => this._log(m),
      current: this._custom
        ? (key, local) => (fs.existsSync(path.join(dir, _DATASETS[key][1])) ? (local[key] ?? null) : null)
        : (key, local) => (force ? null : this._currentTs(key, local)),
    });
    if (!this._custom) this._saveState({ lastCheck: at, lastAttempt: at, lastError: null, source, lastUpdated: updated });
    if (catalog) {
      const { refreshCatalog, catalogInfo } = require('./catalog');
      const before = catalogInfo({ dataDir: this._dataDir }).fetchedAt;
      await refreshCatalog({ dataDir: this._dataDir, fetch: this._fetch, offline: false });
      if (catalogInfo({ dataDir: this._dataDir }).fetchedAt !== before) updated.push('id_catalog.json');
    }
    this._reloadAll();
    return updated;
  }

  /**
   * Deprecated alias of update(): check for new tables now.
   * @param {boolean} [force=false] - Re-download all files even if up to date.
   * @returns {Promise<string[]>} List of filenames that were downloaded/updated.
   */
  async sync(force = false) {
    return this.update({ force });
  }

  // Resolve every table: custom folder exclusively, else newest of data dir / bundled
  _resolve() {
    const out = {};
    if (this._custom) {
      const lu = _readJson(path.join(this._custom, _LAST_UPDATE)) || {};
      const missing = Object.values(_DATASETS).map(([, fn]) => fn)
        .filter((fn) => !fs.existsSync(path.join(this._custom, fn)));
      if (missing.length) {
        throw new Error(
          `TigerTag database folder ${this._custom} is missing: ${missing.join(', ')}. A custom dbPath is `
          + 'used exclusively (no fallback to the bundled copy). Copy the files there, or download them with '
          + `syncDatabases('${this._custom}') / tigertag update --db "${this._custom}".`,
        );
      }
      for (const [key, [, fn]] of Object.entries(_DATASETS)) {
        out[key] = { file: fn, source: 'custom', path: path.join(this._custom, fn), timestamp: lu[key] ?? null };
      }
      return out;
    }
    const bundledLu = _readJson(path.join(_BUNDLED_DB_PATH, _LAST_UPDATE)) || {};
    const dataLu    = _readJson(path.join(this._dataDir, _LAST_UPDATE)) || {};
    for (const [key, [, fn]] of Object.entries(_DATASETS)) {
      const dlFile = path.join(this._dataDir, fn);
      const dlTs = fs.existsSync(dlFile) ? (dataLu[key] ?? null) : null;
      const bTs  = bundledLu[key] ?? null;
      out[key] = dlTs != null && (bTs == null || dlTs > bTs)
        ? { file: fn, source: 'downloaded', path: dlFile, timestamp: dlTs }
        : { file: fn, source: 'bundled', path: path.join(_BUNDLED_DB_PATH, fn), timestamp: bTs };
    }
    return out;
  }

  _reloadAll() {
    this._sources = this._resolve();
    for (const [key, src] of Object.entries(this._sources)) {
      let data = _readJson(src.path);
      if (!Array.isArray(data) && src.source === 'downloaded') {   // broken download → bundled copy
        const fb = path.join(_BUNDLED_DB_PATH, src.file);
        data = _readJson(fb);
        this._sources[key] = { ...src, source: 'bundled', path: fb };
      }
      if (!Array.isArray(data)) {
        if (src.source === 'custom') throw new Error(`TigerTag database file ${src.path} is not a valid JSON list.`);
        data = [];
      }
      this[_PROPS[key]] = data;
    }
  }

  /**
   * Where every table comes from, and the update / catalogue status.
   *
   * @returns {{ offline: boolean, autoUpdate: boolean, maxAge: number, dataDir: string, customDir: string|null,
   *             lastCheck: string|null, lastAttempt: string|null, lastError: string|null,
   *             tables: Object<string, { file: string, source: 'custom'|'downloaded'|'bundled', path: string,
   *                                      timestamp: number|null }>, catalog: object }}
   */
  info() {
    const st = this._custom ? {} : this._state();
    const { catalogInfo } = require('./catalog');
    return {
      offline:     this._offline,
      autoUpdate:  this._autoUpdate,
      maxAge:      this._maxAge,
      dataDir:     this._dataDir,
      customDir:   this._custom,
      lastCheck:   st.lastCheck || null,
      lastAttempt: st.lastAttempt || null,
      lastError:   st.lastError || null,
      tables:      JSON.parse(JSON.stringify(this._sources)),
      catalog:     catalogInfo({ dataDir: this._dataDir }),
    };
  }

  static _find(table, idValue) {
    return table.find((e) => e.id === idValue) || null;
  }

  /**
   * Look up a version entry by id_tigertag value. Includes public_key for signature verification.
   * @param {number} id
   * @returns {object|null}
   */
  version(id)  { return TigerTagDB._find(this._versions, id); }

  /**
   * Look up a material entry. Includes density, recommended temps, bambuID, etc.
   * @param {number} id
   * @returns {object|null}
   */
  material(id) { return TigerTagDB._find(this._materials, id); }

  /**
   * Look up an aspect entry. Includes color_count.
   * @param {number} id
   * @returns {object|null}
   */
  aspect(id)   { return TigerTagDB._find(this._aspects, id); }

  /**
   * Look up a type entry.
   * @param {number} id
   * @returns {object|null}
   */
  type(id)     { return TigerTagDB._find(this._types, id); }

  /**
   * Look up a diameter entry.
   * @param {number} id
   * @returns {object|null}
   */
  diameter(id) { return TigerTagDB._find(this._diameters, id); }

  /**
   * Look up a brand entry.
   * @param {number} id
   * @returns {object|null}
   */
  brand(id)    { return TigerTagDB._find(this._brands, id); }

  /**
   * Look up a measure unit entry.
   * @param {number} id
   * @returns {object|null}
   */
  unit(id)     { return TigerTagDB._find(this._units, id); }

  /**
   * Safe label string from any DB entry object.
   * @param {object|null} entry
   * @returns {string}
   */
  static label(entry) {
    if (!entry) return 'Unknown';
    return entry.label || entry.name || 'Unknown';
  }
}

TigerTagDB.REQUIRED_FILES = Object.values(_DATASETS).map(([, fn]) => fn);

module.exports = { TigerTagDB, syncDatabases, _BUNDLED_DB_PATH, DEFAULT_UPDATE_MAX_AGE_MS };
