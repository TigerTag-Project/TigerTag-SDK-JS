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
 * TigerTag product catalogue (id_catalog.json) — loader, cache and lookup.
 *
 * The official catalogue lists every TigerTag+ product with the exact data to
 * write on the chip (`RFID_Data`) plus display metadata (title, brand, SKU,
 * barcode, image). A gzip copy ships in the npm package
 * (database/id_catalog.json.gz, refreshed at every release) so it works offline;
 * a fresher copy is downloaded into the data dir (shared with the reference
 * tables) once the local copy is older than `maxAge` (1 day).
 *
 * @example
 * const { loadCatalog, catalogEntry, TigerTag } = require('tigertag');
 * const tag   = await TigerTag.fromCatalog(3527039449);   // ready to burn
 * const entry = await catalogEntry(3527039449);           // title, brand, sku, img_src…
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');
const { defaultDataDir, resolveOffline, BUNDLED_DIR } = require('./datadir');

/** Official catalogue URL (GitHub raw, CORS *). */
const CATALOG_URL =
  'https://raw.githubusercontent.com/TigerTag-Project/TigerTag-RFID-Guide/refs/heads/main/database/id_catalog.json';

/** Default cache lifetime: 1 day (24 h) — the catalogue changes every day. */
const DEFAULT_MAX_AGE_MS = 24 * 3600 * 1000;

const _CACHE_FILE   = 'id_catalog.json';
const _META_FILE    = 'id_catalog.meta.json';
const _BUNDLED_FILE = 'id_catalog.json.gz';
const _memo = new Map();   // key → Promise<Map> (one parse per process)

/**
 * Default folder for the downloaded catalogue: the SDK data dir
 * (TIGERTAG_DATA_DIR, TIGERTAG_CACHE_DIR, or the per-user cache folder).
 *
 * @returns {string}
 */
function defaultCacheDir() { return defaultDataDir(); }

function _toMap(list) {
  if (!Array.isArray(list)) throw new Error('TigerTag catalogue: expected a JSON list of products');
  const map = new Map();
  for (const entry of list) {
    if (entry && entry.id != null) map.set(Number(entry.id), entry);
  }
  return map;
}

function _readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, _META_FILE), 'utf8')); } catch { return null; }
}

function _writeMeta(dir, meta) {
  try { fs.writeFileSync(path.join(dir, _META_FILE), JSON.stringify(meta, null, 2)); } catch { /* read-only */ }
}

// The local copies: downloaded (data dir) and bundled (.gz in the package), with their dates
function _localCopies(dataDir, bundledDir) {
  const out = { downloaded: null, bundled: null };
  const file = path.join(dataDir, _CACHE_FILE);
  try {
    const st = fs.statSync(file);
    const meta = _readMeta(dataDir) || {};
    out.downloaded = {
      source: 'downloaded', file, meta,
      fetchedAt: meta.fetchedAt || st.mtime.toISOString(),
      checkedMs: st.mtimeMs,
      read: () => fs.readFileSync(file, 'utf8'),
    };
  } catch { /* none */ }
  if (bundledDir) {
    const gz = path.join(bundledDir, _BUNDLED_FILE);
    try {
      const st = fs.statSync(gz);
      const meta = _readMeta(bundledDir) || {};
      const fetchedAt = meta.fetchedAt || st.mtime.toISOString();
      out.bundled = {
        source: 'bundled', file: gz, meta, fetchedAt,
        checkedMs: Date.parse(fetchedAt),
        read: () => zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8'),
      };
    } catch { /* none */ }
  }
  return out;
}

function _newest(copies) {
  const list = [copies.downloaded, copies.bundled].filter(Boolean);
  if (!list.length) return null;
  return list.reduce((a, b) => (Date.parse(b.fetchedAt) > Date.parse(a.fetchedAt) ? b : a));
}

// Conditional GET: ETag / Last-Modified from the previous download → 304 skips the 12 MB body
async function _download(url, fetchImpl, timeoutMs, prev) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('fetch() is not available (Node.js 18+ required)');
  const headers = {};
  if (prev && prev.etag)         headers['If-None-Match']     = prev.etag;
  if (prev && prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await f(url, { signal: controller.signal, headers });
    const h = (name) => (resp.headers && typeof resp.headers.get === 'function' ? resp.headers.get(name) : null) || null;
    if (resp.status === 304) return { notModified: true, etag: h('etag') || prev.etag, lastModified: h('last-modified') || prev.lastModified };
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { text: await resp.text(), etag: h('etag'), lastModified: h('last-modified') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load the TigerTag catalogue as a Map productId → entry.
 *
 * Copies: the downloaded one in the data dir and the gzip one bundled in the
 * package; the newest is used. When it is older than `maxAge` (or `force`), a
 * conditional download checks for a new version (an unchanged catalogue answers
 * 304 — nothing is re-downloaded). Offline (`offline: true` or
 * TIGERTAG_OFFLINE=1), or when the download fails, the newest local copy is used
 * with zero / no further network calls. Throws only when there is no copy at all.
 *
 * @param {object}   [options]
 * @param {string}   [options.url=CATALOG_URL]  - Catalogue URL.
 * @param {string}   [options.dataDir]          - Folder for the downloaded copy (default: the SDK data dir).
 * @param {string}   [options.cacheDir]         - Alias of dataDir.
 * @param {boolean}  [options.offline]          - true = zero network calls (default: TIGERTAG_OFFLINE env).
 * @param {number}   [options.maxAge=1 day]     - Max age in ms of the local copy before checking for a new version.
 * @param {boolean}  [options.force=false]      - Check for a new version now (ignore memory and age).
 * @param {number}   [options.timeout=60000]    - Download timeout in ms.
 * @param {Function} [options.fetch]            - fetch implementation (default: global fetch).
 * @param {string|null} [options.bundledDir]    - Folder of the bundled .gz (default: the package database/;
 *                                                null = ignore the bundled copy).
 * @returns {Promise<Map<number, object>>}
 */
function loadCatalog({
  url = CATALOG_URL, dataDir, cacheDir, offline, maxAge = DEFAULT_MAX_AGE_MS,
  force = false, timeout = 60000, fetch: fetchImpl = null, bundledDir = BUNDLED_DIR,
} = {}) {
  const dir = path.resolve(dataDir || cacheDir || defaultDataDir());
  const isOffline = resolveOffline(offline);
  const key = `${url}|${dir}|${bundledDir}|${isOffline}`;
  if (!force && _memo.has(key)) return _memo.get(key);
  const p = (async () => {
    const copies = _localCopies(dir, bundledDir);
    const newest = _newest(copies);
    const readNewest = () => _toMap(JSON.parse(newest.read()));
    if (isOffline) {
      if (newest) return readNewest();
      throw new Error(`TigerTag catalogue unavailable offline: no local copy in ${dir} and no bundled copy.`);
    }
    const lastChecked = Math.max(copies.downloaded ? copies.downloaded.checkedMs : 0, copies.bundled ? copies.bundled.checkedMs : 0);
    if (!force && newest && maxAge > 0 && Date.now() - lastChecked < maxAge) return readNewest();

    const prevMeta = copies.downloaded && copies.downloaded.meta.url === url ? copies.downloaded.meta
      : copies.bundled && (!copies.downloaded || newest === copies.bundled) ? copies.bundled.meta : null;
    let res;
    try {
      res = await _download(url, fetchImpl, timeout, prevMeta);
    } catch (err) {
      if (newest) return readNewest();   // stale but usable
      throw new Error(
        `TigerTag catalogue unavailable: could not download ${url} (${err.message}) `
        + `and there is no local copy in ${dir}. An internet connection is needed the first time.`,
      );
    }
    const now = new Date().toISOString();
    const file = path.join(dir, _CACHE_FILE);
    let text = res.text;
    let fetchedAt = now;
    if (res.notModified) {
      // Unchanged: keep (or materialise) the copy the ETag came from, record the check
      const from = prevMeta === (copies.downloaded && copies.downloaded.meta) ? copies.downloaded : copies.bundled;
      text = from.read();
      fetchedAt = from.fetchedAt;
    }
    const map = _toMap(JSON.parse(text));
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (!(res.notModified && copies.downloaded && prevMeta === copies.downloaded.meta)) fs.writeFileSync(file, text);
      else fs.utimesSync(file, new Date(), new Date());
      _writeMeta(dir, {
        url, count: map.size, fetchedAt, checkedAt: now,
        etag: res.etag || null, lastModified: res.lastModified || null, bytes: Buffer.byteLength(text),
      });
    } catch { /* read-only data dir: keep the in-memory copy */ }
    return map;
  })();
  _memo.set(key, p);
  p.catch(() => _memo.delete(key));   // a failed load is retried next time
  return p;
}

/**
 * Check for a new catalogue version now (conditional download) and reload it.
 * Same options as loadCatalog(), with `force: true`.
 *
 * @param {object} [options]
 * @returns {Promise<Map<number, object>>}
 */
function refreshCatalog(options = {}) {
  return loadCatalog({ ...options, force: true });
}

/**
 * Which catalogue copy is used, without loading it.
 *
 * @param {object} [options]
 * @param {string} [options.dataDir]     - Data dir (default: the SDK data dir). `cacheDir` is an alias.
 * @param {string|null} [options.bundledDir] - Bundled folder (default: package database/; null = ignore).
 * @returns {{ downloaded: boolean, source: 'downloaded'|'bundled'|null, count: number|null,
 *             fetchedAt: string|null, checkedAt: string|null, url: string|null, etag: string|null,
 *             lastModified: string|null, cacheFile: string, bundled: object|null }}
 *   `source` = the copy in use (the newest), `fetchedAt` = when that copy was downloaded,
 *   `checkedAt` = last check for a new version, `downloaded` = a copy exists in the data dir.
 */
function catalogInfo({ dataDir, cacheDir, bundledDir = BUNDLED_DIR } = {}) {
  const dir = path.resolve(dataDir || cacheDir || defaultDataDir());
  const copies = _localCopies(dir, bundledDir);
  const newest = _newest(copies);
  const cacheFile = path.join(dir, _CACHE_FILE);
  const b = copies.bundled ? { file: copies.bundled.file, fetchedAt: copies.bundled.fetchedAt, count: copies.bundled.meta.count ?? null } : null;
  if (!newest) {
    return { downloaded: false, source: null, count: null, fetchedAt: null, checkedAt: null, url: null, etag: null, lastModified: null, cacheFile, bundled: b };
  }
  const m = newest.meta || {};
  const dm = copies.downloaded ? copies.downloaded.meta : {};
  return {
    downloaded:   !!copies.downloaded,
    source:       newest.source,
    count:        m.count ?? null,
    fetchedAt:    newest.fetchedAt,
    checkedAt:    dm.checkedAt || (copies.downloaded ? new Date(copies.downloaded.checkedMs).toISOString() : null),
    url:          m.url || null,
    etag:         m.etag || null,
    lastModified: m.lastModified || null,
    cacheFile,
    bundled:      b,
  };
}

/**
 * Look up one catalogue product.
 *
 * @param {number} productId - TigerTag+ product ID.
 * @param {object} [options]
 * @param {Map<number, object>} [options.catalog] - Already loaded catalogue; otherwise loadCatalog(options).
 * @returns {Promise<object|null>} The catalogue entry (title, brand, sku, barcode, img_src, RFID_Data…) or null.
 */
async function catalogEntry(productId, options = {}) {
  const catalog = options.catalog || await loadCatalog(options);
  return catalog.get(Number(productId)) || null;
}

/** Clear the in-memory catalogue copies (the disk cache is kept). */
function clearCatalogMemo() { _memo.clear(); }

module.exports = {
  CATALOG_URL, DEFAULT_MAX_AGE_MS, defaultCacheDir,
  loadCatalog, refreshCatalog, catalogInfo, catalogEntry, clearCatalogMemo,
};
