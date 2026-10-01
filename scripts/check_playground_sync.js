#!/usr/bin/env node
'use strict';

// tools/playground.html must be byte-for-byte identical in the JavaScript and Python SDKs
// (docs/playground-api.md). Compares this copy with the sibling repository's copy: the local
// checkout next to this one when present (or TIGERTAG_SIBLING_REPO), otherwise the other
// repository's main branch on GitHub.
//
//   node scripts/check_playground_sync.js     → exit 0 identical, 1 different, 2 sibling unreachable

const fs   = require('fs');
const path = require('path');

const ROOT  = path.join(__dirname, '..');
const LOCAL = path.join(ROOT, 'tools', 'playground.html');
const SIBLING_DIRS = ['tigertag-sdk-python', 'TigerTag-SDK-Python'];
const SIBLING_RAW  = 'https://raw.githubusercontent.com/TigerTag-Project/TigerTag-SDK-Python/main/tools/playground.html';

async function siblingCopy() {
  const dirs = process.env.TIGERTAG_SIBLING_REPO
    ? [process.env.TIGERTAG_SIBLING_REPO]
    : SIBLING_DIRS.map((d) => path.join(ROOT, '..', d));
  for (const dir of dirs) {
    const file = path.join(dir, 'tools', 'playground.html');
    if (fs.existsSync(file)) return { source: file, data: fs.readFileSync(file) };
  }
  if (/^(1|true|yes|on)$/i.test(process.env.TIGERTAG_OFFLINE || '')) return null;   // no network call
  try {
    const resp = await fetch(SIBLING_RAW, { signal: AbortSignal.timeout(10000) });
    if (resp.ok) return { source: SIBLING_RAW, data: Buffer.from(await resp.arrayBuffer()) };
  } catch { /* offline */ }
  return null;
}

async function check() {
  const mine = fs.readFileSync(LOCAL);
  const other = await siblingCopy();
  if (!other) return { status: 'unreachable' };
  if (mine.equals(other.data)) return { status: 'identical', source: other.source };
  let line = 1;
  const n = Math.min(mine.length, other.data.length);
  let i = 0;
  for (; i < n && mine[i] === other.data[i]; i++) if (mine[i] === 10) line++;
  return { status: 'different', source: other.source, line };
}

module.exports = { check };

if (require.main === module) {
  check().then((r) => {
    if (r.status === 'identical') { console.log(`OK — tools/playground.html identical to ${r.source}`); process.exit(0); }
    if (r.status === 'unreachable') { console.log('SKIP — sibling playground.html not reachable (no local checkout, offline)'); process.exit(2); }
    console.error(`FAILED — tools/playground.html differs from ${r.source} (first difference at line ${r.line}).`
      + '\nCopy the unified page to both repositories (see docs/playground-api.md).');
    process.exit(1);
  });
}
