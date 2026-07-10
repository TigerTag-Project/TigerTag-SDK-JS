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
 * TigerTag reference database loader and sync utilities.
 */

const fs   = require('fs');
const path = require('path');

const _API_BASE        = 'https://api.tigertag.io/api:tigertag';
const _GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/TigerTag-Project/TigerTag-RFID-Guide/main/database';
const _HTTP_TIMEOUT    = 30000;

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

const _BUNDLED_DB_PATH = path.join(__dirname, '..', 'database');

/**
 * Download or update TigerTag reference JSON databases.
 * Tries the live TigerTag API first; falls back to the GitHub mirror.
 * Only downloads files whose timestamp has changed.
 *
 * @param {string} [dbPath] - Folder where JSON files are stored (created if missing).
 * @param {object} [options]
 * @param {boolean} [options.force=false]   - Re-download all files even if up to date.
 * @param {boolean} [options.verbose=true]  - Print progress to stdout.
 * @returns {Promise<string[]>} List of filenames that were downloaded/updated.
 */
async function syncDatabases(dbPath, { force = false, verbose = true } = {}) {
  const resolvedPath = path.resolve(dbPath || _BUNDLED_DB_PATH);
  fs.mkdirSync(resolvedPath, { recursive: true });

  const lastUpdatePath = path.join(resolvedPath, 'last_update.json');

  const _log = verbose ? (msg) => console.log(msg) : () => {};

  async function _get(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _HTTP_TIMEOUT);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      return { data: JSON.parse(text), text };
    } finally {
      clearTimeout(timer);
    }
  }

  let remoteData, remoteText, datasetUrlFn;

  try {
    const result = await _get(`${_API_BASE}/all/last_update`);
    remoteData = result.data;
    remoteText = result.text;
    datasetUrlFn = (endpoint, _filename) => `${_API_BASE}/${endpoint}`;
    _log('[info] source: api');
  } catch (exc) {
    _log(`[warn] TigerTag API unreachable (${exc.message}), falling back to GitHub mirror`);
    try {
      const result = await _get(`${_GITHUB_RAW_BASE}/last_update.json`);
      remoteData = result.data;
      remoteText = result.text;
      datasetUrlFn = (_endpoint, filename) => `${_GITHUB_RAW_BASE}/${filename}`;
      _log('[info] source: github');
    } catch (exc2) {
      throw new Error(
        `Both API and GitHub mirror are unreachable.\nAPI error: ${exc.message}\nGitHub error: ${exc2.message}\nCheck your internet connection.`,
      );
    }
  }

  let localData = {};
  if (fs.existsSync(lastUpdatePath)) {
    try {
      localData = JSON.parse(fs.readFileSync(lastUpdatePath, 'utf8'));
    } catch (_) {}
  }

  const updated = [];

  for (const [key, [endpoint, filename]] of Object.entries(_DATASETS)) {
    const remoteTs = remoteData[key];
    const localTs  = localData[key];
    const localFile = path.join(resolvedPath, filename);

    if (remoteTs == null) {
      _log(`[skip] ${key}: not in last_update payload`);
      continue;
    }

    if (!force && remoteTs === localTs && fs.existsSync(localFile)) {
      _log(`[ok]   ${filename}: up to date`);
      continue;
    }

    _log(`[sync] ${filename}: ${localTs} → ${remoteTs}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _HTTP_TIMEOUT);
    try {
      const resp = await fetch(datasetUrlFn(endpoint, filename), { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      fs.writeFileSync(localFile, JSON.stringify(data, null, 2), 'utf8');
      updated.push(filename);
    } finally {
      clearTimeout(timer);
    }
  }

  if (updated.length > 0 || JSON.stringify(localData) !== JSON.stringify(remoteData)) {
    fs.writeFileSync(lastUpdatePath, remoteText, 'utf8');
    if (!updated.includes('last_update.json')) updated.push('last_update.json');
  }

  return updated;
}

/**
 * Loads and exposes TigerTag JSON reference databases.
 *
 * Ships with bundled JSON files so the SDK works offline immediately after install.
 * Optionally syncs updates from the TigerTag API or GitHub mirror via sync().
 *
 * All ID lookups return the full JSON entry object (or null if not found).
 * The JSON files are the single source of truth — no hardcoded ID mappings.
 *
 * @example
 * const db = new TigerTagDB();
 * const mat = db.material(38219);
 * console.log(mat.label);   // "PLA"
 * console.log(mat.density); // 1.24
 */
class TigerTagDB {
  /**
   * @param {object} [options]
   * @param {string}  [options.dbPath]    - Path to database directory. Defaults to bundled DB.
   * @param {boolean} [options.autoSync]  - Flag; call db.sync() manually to download files.
   * @param {boolean} [options.verbose]   - Print sync progress (default true).
   */
  constructor({ dbPath, autoSync = false, verbose = true } = {}) {
    this._path     = dbPath ? path.resolve(dbPath) : _BUNDLED_DB_PATH;
    this._autoSync = autoSync;
    this._verbose  = verbose;
    this._ensureDb();
    this._versions  = this._load('id_version.json');
    this._materials = this._load('id_material.json');
    this._aspects   = this._load('id_aspect.json');
    this._types     = this._load('id_type.json');
    this._diameters = this._load('id_diameter.json');
    this._brands    = this._load('id_brand.json');
    this._units     = this._load('id_measure_unit.json');
  }

  _ensureDb() {
    const missing = TigerTagDB.REQUIRED_FILES.filter(
      (fn) => !fs.existsSync(path.join(this._path, fn)),
    );
    if (missing.length === 0) return;

    // Fallback to bundled database if user provided a custom path
    if (this._path !== _BUNDLED_DB_PATH && fs.existsSync(_BUNDLED_DB_PATH)) {
      const stillMissing = TigerTagDB.REQUIRED_FILES.filter(
        (fn) => !fs.existsSync(path.join(_BUNDLED_DB_PATH, fn)),
      );
      if (stillMissing.length === 0) {
        this._path = _BUNDLED_DB_PATH;
        return;
      }
    }

    process.stderr.write(
      `\nTigerTag database files not found.\n  Expected: ${path.resolve(this._path)}\n\n  Missing:\n`
      + missing.map((fn) => `    - ${fn}`).join('\n')
      + '\n\n  Call await db.sync() to download them.\n\n',
    );
  }

  _load(filename) {
    const fp = path.join(this._path, filename);
    if (!fs.existsSync(fp)) return [];
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (_) {
      return [];
    }
  }

  _reloadAll() {
    this._versions  = this._load('id_version.json');
    this._materials = this._load('id_material.json');
    this._aspects   = this._load('id_aspect.json');
    this._types     = this._load('id_type.json');
    this._diameters = this._load('id_diameter.json');
    this._brands    = this._load('id_brand.json');
    this._units     = this._load('id_measure_unit.json');
  }

  static _find(table, idValue) {
    return table.find((e) => e.id === idValue) || null;
  }

  /**
   * Manually trigger a database update.
   * @param {boolean} [force=false] - Re-download all files even if up to date.
   * @returns {Promise<string[]>} List of filenames that were downloaded/updated.
   */
  async sync(force = false) {
    const updated = await syncDatabases(this._path, { force, verbose: this._verbose });
    this._reloadAll();
    return updated;
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

module.exports = { TigerTagDB, syncDatabases, _BUNDLED_DB_PATH };
