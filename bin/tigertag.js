#!/usr/bin/env node
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

const fs   = require('fs');
const path = require('path');

const { TigerTag, TigerTagDB, SignatureResult, syncDatabases } = require('../src/index');

const VERSION = require('../package.json').version;

const HELP = `
Usage: tigertag [dump.bin] [options]
       tigertag update [--force] [--catalog] [--data-dir PATH | --db PATH]

Parse, verify, and export TigerTag RFID chip dumps.

Arguments:
  dump.bin              Binary .bin file to parse

Commands:
  update                Check for new reference tables now and download the changed ones
                        (into the data dir, or into --db PATH)

Options:
  --db <path>           Custom database folder, used exclusively (no fallback)
  --data-dir <path>     Folder for downloaded reference data (default: TIGERTAG_DATA_DIR
                        or the per-user cache folder)
  --offline             No network call at all (same as TIGERTAG_OFFLINE=1)
  --force               update: re-download every table
  --catalog             update: also check for a new product catalogue
  --json                Output as JSON
  --raw                 Raw protocol fields, no DB lookup
  --no-sync             Do not run the automatic daily check
  --sync-only           Same as "update"
  --version             Show version
  -h, --help            Show this help

Dump formats:
  180 bytes  Full chip dump (pages 0-44): UID auto-extracted, signature verifiable
  144 bytes  User data + signature (pages 0x04-0x27)
   80 bytes  User data only (pages 0x04-0x17)

Examples:
  tigertag dump.bin              Parse + human-readable output
  tigertag dump.bin --json       Output as JSON
  tigertag dump.bin --offline    Parse without any network call
  tigertag update                Update the reference tables now
  tigertag update --catalog      Same, plus the product catalogue

Spec: https://github.com/TigerTag-Project/TigerTag-RFID-Guide
`.trim();

function parseArgs(argv) {
  const args = {
    dump: null, db: null, dataDir: null, json: false, raw: false, noSync: false,
    update: false, force: false, catalog: false, offline: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json')           args.json     = true;
    else if (a === '--raw')       args.raw      = true;
    else if (a === '--no-sync')   args.noSync   = true;
    else if (a === '--sync-only' || (a === 'update' && !args.dump && !args.update)) args.update = true;
    else if (a === '--force')     args.force    = true;
    else if (a === '--catalog')   args.catalog  = true;
    else if (a === '--offline')   args.offline  = true;
    else if (a === '--version') { console.log(`tigertag ${VERSION}`); process.exit(0); }
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--db')        args.db = argv[++i];
    else if (a === '--data-dir')  args.dataDir = argv[++i];
    else if (!a.startsWith('-'))  args.dump = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.offline) process.env.TIGERTAG_OFFLINE = '1';   // no network call anywhere in this process
  const dbPath = args.db ? path.resolve(args.db) : undefined;
  const dataDir = args.dataDir ? path.resolve(args.dataDir) : undefined;

  if (args.update) {
    try {
      let updated;
      if (dbPath) {
        updated = await syncDatabases(dbPath, { force: args.force, verbose: true });
      } else {
        const db = new TigerTagDB({ dataDir, offline: args.offline || undefined, autoUpdate: false, verbose: true });
        updated = await db.update({ force: args.force, catalog: args.catalog });
        console.log(`Data dir: ${db.info().dataDir}`);
      }
      if (updated.length > 0) {
        console.log(`\nUpdated ${updated.length} file(s): ${updated.join(', ')}`);
      } else {
        console.log('\nAll reference data already up to date.');
      }
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  if (!args.dump) {
    console.log(HELP);
    return;
  }

  let raw;
  try {
    raw = fs.readFileSync(args.dump);
  } catch (_) {
    process.stderr.write(`Error: file not found: ${args.dump}\n`);
    process.exit(1);
  }

  let tag;
  try {
    tag = TigerTag.fromDump(raw);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  for (const w of tag.validate()) {
    process.stderr.write(`Warning: ${w}\n`);
  }

  let db;
  try {
    db = new TigerTagDB({
      dbPath, dataDir,
      offline: args.offline || undefined,
      autoUpdate: !args.noSync && !args.raw,
    });
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
  tag._db = db;   // every lookup (toRawDict / toDict / pretty) uses this database

  if (args.raw) {
    console.log(JSON.stringify(tag.toRawDict(), null, 2));
    return;
  }

  const sigResult = tag.isSigned
    ? tag.verify(db)
    : new SignatureResult(SignatureResult.UNSIGNED);

  if (args.json) {
    const d = tag.toDict(db);
    d.signature = sigResult.toDict();
    console.log(JSON.stringify(d, null, 2, (_, v) => typeof v === 'bigint' ? v.toString() : v));
  } else {
    console.log(tag.pretty(db, sigResult));
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
});
