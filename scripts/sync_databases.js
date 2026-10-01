#!/usr/bin/env node
'use strict';

// Refresh the copies bundled in the npm package (database/):
//   - the 7 reference tables + last_update.json (only the changed ones),
//   - the product catalogue as database/id_catalog.json.gz + id_catalog.meta.json
//     (rewritten only when its content changed, so an unchanged day makes no diff).
// Run by .github/workflows/sync-databases.yml every day and by publish.yml before
// every release.

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const { syncDatabases, CATALOG_URL } = require('../src/index');

const dbPath   = path.join(__dirname, '..', 'database');
const gzFile   = path.join(dbPath, 'id_catalog.json.gz');
const metaFile = path.join(dbPath, 'id_catalog.meta.json');

async function syncCatalog() {
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch { /* first run */ }
  const headers = fs.existsSync(gzFile) && meta.etag ? { 'If-None-Match': meta.etag } : {};
  const resp = await fetch(CATALOG_URL, { headers, signal: AbortSignal.timeout(120000) });
  if (resp.status === 304) return false;
  if (!resp.ok) throw new Error(`catalogue: HTTP ${resp.status}`);
  const text = await resp.text();
  const list = JSON.parse(text);
  if (!Array.isArray(list) || list.length === 0) throw new Error('catalogue: expected a non-empty JSON list');
  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  if (sha256 === meta.sha256 && fs.existsSync(gzFile)) return false;
  fs.writeFileSync(gzFile, zlib.gzipSync(Buffer.from(text), { level: 9 }));
  fs.writeFileSync(metaFile, JSON.stringify({
    url: CATALOG_URL, count: list.length, fetchedAt: new Date().toISOString(),
    etag: resp.headers.get('etag'), lastModified: resp.headers.get('last-modified'),
    bytes: Buffer.byteLength(text), sha256,
  }, null, 2) + '\n');
  return true;
}

(async () => {
  const updated = await syncDatabases(dbPath, { force: false, verbose: true });
  if (await syncCatalog()) updated.push('id_catalog.json.gz', 'id_catalog.meta.json');
  console.log(updated.length ? `\nOK — updated: ${updated.join(', ')}` : '\nOK — all databases are up to date.');
})().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
