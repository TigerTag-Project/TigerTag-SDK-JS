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
const { _BUNDLED_DB_PATH } = require('../src/db');

const VERSION = require('../package.json').version;

const HELP = `
Usage: tigertag [dump.bin] [options]

Parse, verify, and export TigerTag RFID chip dumps.

Arguments:
  dump.bin              Binary .bin file to parse

Options:
  --db <path>           Database folder (default: bundled database)
  --json                Output as JSON
  --raw                 Raw protocol fields, no DB lookup
  --no-sync             Do not auto-download databases
  --sync-only           Update databases and exit
  --version             Show version
  -h, --help            Show this help

Dump formats:
  180 bytes  Full chip dump (pages 0-44): UID auto-extracted, signature verifiable
  144 bytes  User data + signature (pages 0x04-0x27)
   80 bytes  User data only (pages 0x04-0x17)

Examples:
  tigertag dump.bin              Parse + human-readable output
  tigertag dump.bin --json       Output as JSON
  tigertag dump.bin --raw        Raw protocol fields, no DB lookup
  tigertag --sync-only           Update reference databases and exit

Spec: https://github.com/TigerTag-Project/TigerTag-RFID-Guide
`.trim();

function parseArgs(argv) {
  const args = { dump: null, db: null, json: false, raw: false, noSync: false, syncOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json')         args.json     = true;
    else if (a === '--raw')     args.raw      = true;
    else if (a === '--no-sync') args.noSync   = true;
    else if (a === '--sync-only') args.syncOnly = true;
    else if (a === '--version') { console.log(`tigertag ${VERSION}`); process.exit(0); }
    else if (a === '-h' || a === '--help') { console.log(HELP); process.exit(0); }
    else if (a === '--db')      args.db = argv[++i];
    else if (!a.startsWith('-')) args.dump = a;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.db ? path.resolve(args.db) : _BUNDLED_DB_PATH;

  if (args.syncOnly) {
    try {
      const updated = await syncDatabases(dbPath, { verbose: true });
      if (updated.length > 0) {
        console.log(`\nUpdated ${updated.length} file(s): ${updated.join(', ')}`);
      } else {
        console.log('\nAll databases already up to date.');
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

  if (args.raw) {
    console.log(JSON.stringify(tag.toRawDict(), null, 2));
    return;
  }

  const db = new TigerTagDB({ dbPath });
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
