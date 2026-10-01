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
 * Where the SDK keeps downloaded reference data (tables + catalogue), and the
 * global offline switch.
 */

const os   = require('os');
const path = require('path');

/**
 * Folder holding the downloaded fresh copies of the reference tables and the
 * catalogue. Precedence: `TIGERTAG_DATA_DIR`, then `TIGERTAG_CACHE_DIR`, then the
 * platform cache folder (`~/Library/Caches`, `%LOCALAPPDATA%`, `$XDG_CACHE_HOME`
 * or `~/.cache`) + `/tigertag`.
 *
 * @returns {string}
 */
function defaultDataDir() {
  if (process.env.TIGERTAG_DATA_DIR)  return process.env.TIGERTAG_DATA_DIR;
  if (process.env.TIGERTAG_CACHE_DIR) return process.env.TIGERTAG_CACHE_DIR;
  const home = os.homedir();
  let base;
  if (process.platform === 'darwin')     base = path.join(home, 'Library', 'Caches');
  else if (process.platform === 'win32') base = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  else                                   base = process.env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(base, 'tigertag');
}

/**
 * Resolve the offline switch: an explicit option wins, otherwise the
 * `TIGERTAG_OFFLINE` environment variable (`1`, `true`, `yes`, `on`).
 *
 * @param {boolean} [option]
 * @returns {boolean}
 */
function resolveOffline(option) {
  if (option === true || option === false) return option;
  return /^(1|true|yes|on)$/i.test(String(process.env.TIGERTAG_OFFLINE || ''));
}

/** Folder of the copies shipped inside the npm package. */
const BUNDLED_DIR = path.join(__dirname, '..', 'database');

module.exports = { defaultDataDir, resolveOffline, BUNDLED_DIR };
