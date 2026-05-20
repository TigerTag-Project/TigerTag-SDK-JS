'use strict';

// TigerTag RFID Guide
// Copyright (C) 2025 TigerTag
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License.

/**
 * tigertag — JavaScript SDK for TigerTag RFID material identification.
 *
 * Spec    : https://github.com/TigerTag-Project/TigerTag-RFID-Guide
 * Protocol: TigerTag Open Source v2.1
 *
 * Quick start:
 *   const { TigerTag } = require('tigertag');
 *
 *   const tag = TigerTag.fromPages(payload, uid);  // from NFC SDK
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
