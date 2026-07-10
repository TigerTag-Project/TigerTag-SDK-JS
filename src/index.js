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
 * tigertag — JavaScript SDK for TigerTag RFID material identification.
 *
 * Spec    : https://github.com/TigerTag-Project/TigerTag-RFID-Guide
 * Protocol: TigerTag Open Source v2.1
 *
 * Quick start:
 *   const { TigerTag } = require('tigertag');
 *
 *   const tag = TigerTag.fromPages(uid, payload);  // from NFC SDK
 *   const tag = TigerTag.fromDump(data);           // from binary dump
 *   const tag = TigerTag.fromFile('dump.bin');     // from file
 *
 *   console.log(tag.pretty());      // human-readable
 *   console.log(tag.toRawDict());   // raw protocol fields
 *   console.log(tag.toDict());      // enriched with labels, hex colors, dates
 *   console.log(tag.verify());      // ECDSA signature result
 */

const {
  TigerTag,
  ApiDiff,
  CHIP_DUMP_LEN,
  FULL_DATA_LEN,
  MIN_DATA_LEN,
  MAKER_PRODUCT_ID,
  INIT_PRODUCT_ID,
  ID_TIGERTAG,
  ID_TIGERTAG_PLUS,
  ID_TIGERTAG_INIT,
  TIGERTAG_EPOCH,
} = require('./tag');

const { TigerTagDB, syncDatabases }  = require('./db');
const { SignatureResult, ecdsaRawToDer } = require('./signature');

module.exports = {
  TigerTag,
  TigerTagDB,
  SignatureResult,
  ApiDiff,
  syncDatabases,
  ecdsaRawToDer,
  CHIP_DUMP_LEN,
  FULL_DATA_LEN,
  MIN_DATA_LEN,
  MAKER_PRODUCT_ID,
  INIT_PRODUCT_ID,
  ID_TIGERTAG,
  ID_TIGERTAG_PLUS,
  ID_TIGERTAG_INIT,
  TIGERTAG_EPOCH,
};
