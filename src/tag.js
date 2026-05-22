'use strict';

// TigerTag RFID Guide
// Copyright (C) 2025 TigerTag
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License.

/**
 * TigerTag class — binary parsing, serialization, CRUD, and cloud sync.
 */

const { TigerTagDB, syncDatabases, _BUNDLED_DB_PATH } = require('./db');
const { SignatureResult, verifySignature } = require('./signature');

// ── Protocol constants ──────────────────────────────────────────────────────

const CHIP_DUMP_LEN    = 180;
const FULL_DATA_LEN    = 144;
const MIN_DATA_LEN     = 80;

const MAKER_PRODUCT_ID = 0xFFFFFFFF;
const INIT_PRODUCT_ID  = 0x00000000;

const ID_TIGERTAG      = 0x5BF59264;
const ID_TIGERTAG_PLUS = 0xBC0FCB97;
const ID_TIGERTAG_INIT = 0x6C41A2E1;

const TIGERTAG_EPOCH    = new Date('2000-01-01T00:00:00Z');
const _TIGERTAG_EPOCH_MS = TIGERTAG_EPOCH.getTime();

const _PRODUCT_PAGE_BASE = 'https://tigertag.io/pages/product-infos';
const _API_PRODUCT_BASE  = 'https://api.tigertag.io/api:tigertag/product/get';
const _CDN_IMG_BASE      = 'https://cdn.tigertag.io/img';
// Maps id_type → CDN `type` query param. 142=Filament, 173=Resin.
const _IMG_TYPE_MAP      = { 142: 'filament', 173: 'resin' };

const _PROTECTED_FIELDS = new Set([
  'idTigertag', 'idProduct', 'uid', 'signatureR', 'signatureS',
]);

const _PATCHABLE_FIELDS = new Set([
  'idMaterial', 'idAspect1', 'idAspect2', 'idType', 'idDiameter', 'idBrand',
  'color1R', 'color1G', 'color1B', 'color1A',
  'color2R', 'color2G', 'color2B',
  'color3R', 'color3G', 'color3B',
  'measure', 'idUnit', 'measureAvailable',
  'nozzleTempMin', 'nozzleTempMax', 'dryTemp', 'dryTime', 'bedTempMin', 'bedTempMax',
  'timestamp', 'customMessage', 'tdRaw',
]);

// ── ApiDiff ─────────────────────────────────────────────────────────────────

/**
 * A single field difference between chip data and the TigerTag+ cloud API.
 */
class ApiDiff {
  /**
   * @param {string} field      - Field name (e.g. "nozzle_min")
   * @param {*}      chipValue  - Value currently stored on the chip
   * @param {*}      apiValue   - Value returned by the cloud API
   */
  constructor(field, chipValue, apiValue) {
    this.field     = field;
    this.chipValue = chipValue;
    this.apiValue  = apiValue;
  }

  toString() {
    return `  ${this.field}: chip=${JSON.stringify(this.chipValue)}  →  api=${JSON.stringify(this.apiValue)}`;
  }
}

// ── TigerTag ─────────────────────────────────────────────────────────────────

/**
 * TigerTag NTAG-compatible chip payload — CRUD interface.
 *
 * All fields are plain integers/Buffers/strings. Use TigerTagDB (via the
 * .db property or pass one to toDict()) to resolve IDs to labels.
 *
 * @example
 * // Read
 * const tag = TigerTag.fromPages(uid, payload);
 * const tag = TigerTag.fromDump(data);
 * const tag = TigerTag.fromFile('dump.bin');
 *
 * // Create
 * const tag = TigerTag.create({ idMaterial: 38219, nozzleTempMin: 190, ... });
 *
 * // Update
 * const newTag = tag.patch({ dryTemp: 55, nozzleTempMax: 240 });
 */
class TigerTag {
  /**
   * Internal constructor — use static factory methods instead.
   * @param {object} fields
   */
  constructor(fields) {
    // Identity
    this.idTigertag = fields.idTigertag;
    this.idProduct  = fields.idProduct;

    // Material
    this.idMaterial = fields.idMaterial || 0;
    this.idAspect1  = fields.idAspect1  || 0;
    this.idAspect2  = fields.idAspect2  || 0;
    this.idType     = fields.idType     || 0;
    this.idDiameter = fields.idDiameter || 0;
    this.idBrand    = fields.idBrand    || 0;

    // Colors
    this.color1R = fields.color1R || 0;
    this.color1G = fields.color1G || 0;
    this.color1B = fields.color1B || 0;
    this.color1A = fields.color1A != null ? fields.color1A : 255;
    this.color2R = fields.color2R || 0;
    this.color2G = fields.color2G || 0;
    this.color2B = fields.color2B || 0;
    this.color3R = fields.color3R || 0;
    this.color3G = fields.color3G || 0;
    this.color3B = fields.color3B || 0;

    // Quantity
    this.measure          = fields.measure          || 0;
    this.idUnit           = fields.idUnit           || 0;
    this.measureAvailable = fields.measureAvailable || 0;

    // Temperatures
    this.nozzleTempMin = fields.nozzleTempMin || 0;
    this.nozzleTempMax = fields.nozzleTempMax || 0;
    this.dryTemp       = fields.dryTemp       || 0;
    this.dryTime       = fields.dryTime       || 0;
    this.bedTempMin    = fields.bedTempMin    || 0;
    this.bedTempMax    = fields.bedTempMax    || 0;

    // Traceability
    this.timestamp     = fields.timestamp     || 0;
    this.customMessage = fields.customMessage || '';

    // HueForge
    this.tdRaw = fields.tdRaw || 0;

    // Signature (optional)
    this.signatureR = fields.signatureR instanceof Buffer ? fields.signatureR : Buffer.alloc(32);
    this.signatureS = fields.signatureS instanceof Buffer ? fields.signatureS : Buffer.alloc(32);

    // Chip UID (7 bytes, null if unavailable)
    this.uid = fields.uid || null;

    // Lazily loaded DB (private)
    this._db = fields._db || null;
  }

  // ── Derived properties ──────────────────────────────────────────────────

  /** True when idProduct === 0xFFFFFFFF (offline Maker tag). */
  get isMaker() { return this.idProduct === MAKER_PRODUCT_ID; }

  /** True when idProduct === 0x00000000 (blank/uninitialized tag). */
  get isInit()  { return this.idProduct === INIT_PRODUCT_ID; }

  /** True when idTigertag === ID_TIGERTAG_PLUS (cloud product). */
  get isPlus()  { return !this.isMaker && !this.isInit; }

  /** True when the tag carries an ECDSA signature (pages 0x18-0x27 non-zero). */
  get isSigned() {
    const empty = Buffer.alloc(32);
    return !this.signatureR.equals(empty) || !this.signatureS.equals(empty);
  }

  /** UID as uppercase hex string (e.g. '04AABBCCDDEE11'), or null. */
  get uidHex() {
    return this.uid ? this.uid.toString('hex').toUpperCase() : null;
  }

  /** HueForge TD as float. 0.0 = undefined, valid range 0.1–100.0. */
  get tdValue() { return this.tdRaw / 10.0; }

  /** Manufacturing timestamp as UTC Date. */
  get manufacturingDate() {
    return new Date(_TIGERTAG_EPOCH_MS + this.timestamp * 1000);
  }

  /** Primary color as #RRGGBB hex string. */
  get color1Hex() {
    return `#${_hex2(this.color1R)}${_hex2(this.color1G)}${_hex2(this.color1B)}`;
  }

  /** Secondary color as #RRGGBB hex string. */
  get color2Hex() {
    return `#${_hex2(this.color2R)}${_hex2(this.color2G)}${_hex2(this.color2B)}`;
  }

  /** Tertiary color as #RRGGBB hex string. */
  get color3Hex() {
    return `#${_hex2(this.color3R)}${_hex2(this.color3G)}${_hex2(this.color3B)}`;
  }

  /** Remaining material as a percentage, or null if measure is zero. */
  get stockPercent() {
    if (this.measure === 0) return null;
    return Math.round((this.measureAvailable / this.measure) * 1000) / 10;
  }

  /** Public product page URL (TigerTag+ only, null otherwise). */
  get productPageUrl() {
    if (this.isMaker || this.isInit) return null;
    return `${_PRODUCT_PAGE_BASE}/${this.idProduct}`;
  }

  /** Direct API URL returning the full enriched product JSON (TigerTag+ only). */
  get apiUrl() {
    if (this.isMaker || this.isInit) return null;
    const uidPart = this.uidHex ? `uid=${BigInt('0x' + this.uidHex)}&` : '';
    return `${_API_PRODUCT_BASE}?${uidPart}product_id=${this.idProduct}`;
  }

  /**
   * CDN image URLs for all 7 sizes (TigerTag+ only, null for Maker/Init).
   *
   * Sizes (all square, cover crop, upscale allowed):
   *   icon 16 · thumb 32 · small 64 · compact 128 · medium 256 · large 512 · master 1024
   *
   * Example: tag.imgUrls.large
   * → "https://cdn.tigertag.io/img?type=filament&id=2159613929&size=large&v=3&stream=1"
   */
  get imgUrls() {
    if (this.isMaker || this.isInit) return null;
    const type = _IMG_TYPE_MAP[this.idType] || 'filament';
    const id   = this.idProduct;
    const v    = Date.now(); // cache-buster — unique on every access
    const mk   = (size) => `${_CDN_IMG_BASE}?type=${type}&id=${id}&size=${size}&v=${v}&stream=1`;
    return {
      icon:    mk('icon'),    //   16 × 16
      thumb:   mk('thumb'),   //   32 × 32
      small:   mk('small'),   //   64 × 64
      compact: mk('compact'), //  128 × 128
      medium:  mk('medium'),  //  256 × 256
      large:   mk('large'),   //  512 × 512
      master:  mk('master'),  // 1024 × 1024
    };
  }

  /** Lazily loaded bundled database. */
  get db() {
    if (!this._db) this._db = new TigerTagDB();
    return this._db;
  }

  // ── Constructors ────────────────────────────────────────────────────────

  /**
   * Parse a TigerTag from NFC SDK native output. (Primary method)
   *
   * @param {Buffer} uid     - 7-byte chip UID as returned by the NFC SDK.
   * @param {Buffer} payload - 80 or 144 bytes (pages 0x04–0x27).
   * @param {TigerTagDB} [db]
   * @returns {TigerTag}
   */
  static fromPages(uid, payload, db = null) {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    if (buf.length !== MIN_DATA_LEN && buf.length !== FULL_DATA_LEN) {
      throw new Error(
        `Invalid payload size: ${buf.length} bytes. `
        + `Expected 80B (pages 0x04-0x17) or 144B (pages 0x04-0x27).`,
      );
    }
    if (!uid || uid.length !== 7) {
      throw new Error(
        `Invalid UID: expected 7 bytes, got ${uid ? uid.length : 0}. `
        + 'Pass the raw bytes returned by your NFC SDK.',
      );
    }
    const tag = TigerTag._parse(buf, db);
    tag.uid = Buffer.isBuffer(uid) ? uid : Buffer.from(uid);
    return tag;
  }

  /**
   * Parse a TigerTag from a raw binary dump.
   *
   * @param {Buffer} data - 80, 144, or 180 bytes.
   * @param {TigerTagDB} [db]
   * @returns {TigerTag}
   */
  static fromDump(data, db = null) {
    let buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    let uid = null;

    if (buf.length === CHIP_DUMP_LEN) {
      // Extract 7-byte UID from system pages: page0[0:3] + page1[0:4]
      uid = Buffer.concat([buf.subarray(0, 3), buf.subarray(4, 8)]);
      buf = buf.subarray(16, 160);
    }

    if (buf.length !== MIN_DATA_LEN && buf.length !== FULL_DATA_LEN) {
      throw new Error(
        `Invalid dump size: ${buf.length} bytes.\n`
        + 'Accepted: 180B (full chip), 144B (user+sig), 80B (user only).',
      );
    }

    const tag = TigerTag._parse(buf, db);
    tag.uid = uid;
    return tag;
  }

  /**
   * Parse a TigerTag from a .bin file.
   *
   * @param {string} filePath - Path to binary dump file.
   * @param {TigerTagDB} [db]
   * @returns {TigerTag}
   */
  static fromFile(filePath, db = null) {
    const fs = require('fs');
    return TigerTag.fromDump(fs.readFileSync(filePath), db);
  }

  /**
   * Internal parser — expects exactly 80 or 144 bytes of user memory.
   * @private
   */
  static _parse(buf, db = null) {
    const u8  = (o) => buf[o];
    const u16 = (o) => buf.readUInt16BE(o);
    const u24 = (o) => ((buf[o] << 16) | (buf[o + 1] << 8) | buf[o + 2]);
    const u32 = (o) => buf.readUInt32BE(o);

    // custom_message: 28 bytes at offset 48, null-terminated UTF-8
    const msgBuf = buf.subarray(48, 76);
    const nullIdx = msgBuf.indexOf(0);
    const customMessage = msgBuf.subarray(0, nullIdx === -1 ? 28 : nullIdx).toString('utf8');

    const signatureR = buf.length >= FULL_DATA_LEN
      ? Buffer.from(buf.subarray(80, 112))
      : Buffer.alloc(32);
    const signatureS = buf.length >= FULL_DATA_LEN
      ? Buffer.from(buf.subarray(112, 144))
      : Buffer.alloc(32);

    return new TigerTag({
      idTigertag:       u32(0),
      idProduct:        u32(4),
      idMaterial:       u16(8),
      idAspect1:        u8(10),
      idAspect2:        u8(11),
      idType:           u8(12),
      idDiameter:       u8(13),
      idBrand:          u16(14),
      color1R:          u8(16),
      color1G:          u8(17),
      color1B:          u8(18),
      color1A:          u8(19),
      measure:          u24(20),
      idUnit:           u8(23),
      nozzleTempMin:    u16(24),
      nozzleTempMax:    u16(26),
      dryTemp:          u8(28),
      dryTime:          u8(29),
      bedTempMin:       u8(30),
      bedTempMax:       u8(31),
      timestamp:        u32(32),
      color2R:          u8(36),
      color2G:          u8(37),
      color2B:          u8(38),
      color3R:          u8(40),
      color3G:          u8(41),
      color3B:          u8(42),
      tdRaw:            u16(44),
      customMessage,
      measureAvailable: u24(76),
      signatureR,
      signatureS,
      uid:              null,
      _db:              db,
    });
  }

  // ── CRUD constructors ───────────────────────────────────────────────────

  /**
   * Create a new TigerTag from scratch.
   *
   * The protocol version (idTigertag) is inferred automatically:
   * - productId omitted or 0xFFFFFFFF → TigerTag (Maker / offline)
   * - productId is a real cloud ID    → TigerTag+
   *
   * @param {object} [options]
   * @param {number}  [options.productId=MAKER_PRODUCT_ID]
   * @param {Buffer}  [options.uid]
   * @param {number}  [options.idMaterial=0]
   * @param {number}  [options.idAspect1=0]
   * @param {number}  [options.idAspect2=0]
   * @param {number}  [options.idType=0]
   * @param {number}  [options.idDiameter=0]
   * @param {number}  [options.idBrand=0]
   * @param {number}  [options.color1R=0]
   * @param {number}  [options.color1G=0]
   * @param {number}  [options.color1B=0]
   * @param {number}  [options.color1A=255]
   * @param {number}  [options.color2R=0]
   * @param {number}  [options.color2G=0]
   * @param {number}  [options.color2B=0]
   * @param {number}  [options.color3R=0]
   * @param {number}  [options.color3G=0]
   * @param {number}  [options.color3B=0]
   * @param {number}  [options.measure=0]
   * @param {number}  [options.idUnit=0]
   * @param {number}  [options.nozzleTempMin=0]
   * @param {number}  [options.nozzleTempMax=0]
   * @param {number}  [options.dryTemp=0]
   * @param {number}  [options.dryTime=0]
   * @param {number}  [options.bedTempMin=0]
   * @param {number}  [options.bedTempMax=0]
   * @param {number}  [options.timestamp]  - Seconds since 2000-01-01 UTC. Defaults to now.
   * @param {string}  [options.customMessage='']
   * @param {number}  [options.tdRaw=0]
   * @param {TigerTagDB} [options.db]
   * @returns {TigerTag}
   */
  static create({
    productId     = MAKER_PRODUCT_ID,
    uid           = null,
    idMaterial    = 0,
    idAspect1     = 0,
    idAspect2     = 0,
    idType        = 0,
    idDiameter    = 0,
    idBrand       = 0,
    color1R       = 0, color1G = 0, color1B = 0, color1A = 255,
    color2R       = 0, color2G = 0, color2B = 0,
    color3R       = 0, color3G = 0, color3B = 0,
    measure       = 0,
    idUnit        = 0,
    nozzleTempMin = 0,
    nozzleTempMax = 0,
    dryTemp       = 0,
    dryTime       = 0,
    bedTempMin    = 0,
    bedTempMax    = 0,
    timestamp        = null,
    customMessage    = '',
    tdRaw            = 0,
    measureAvailable = null,
    db               = null,
  } = {}) {
    let idTigertag;
    if (productId !== MAKER_PRODUCT_ID && productId !== INIT_PRODUCT_ID) {
      idTigertag = ID_TIGERTAG_PLUS;
    } else {
      idTigertag = ID_TIGERTAG;
      productId  = MAKER_PRODUCT_ID;
    }

    if (timestamp == null) {
      timestamp = Math.max(0, Math.floor((Date.now() - _TIGERTAG_EPOCH_MS) / 1000));
    }

    return new TigerTag({
      idTigertag,
      idProduct:        productId,
      idMaterial,
      idAspect1, idAspect2, idType, idDiameter, idBrand,
      color1R, color1G, color1B, color1A,
      color2R, color2G, color2B,
      color3R, color3G, color3B,
      measure,
      idUnit,
      measureAvailable: measureAvailable != null ? measureAvailable : measure,
      nozzleTempMin, nozzleTempMax, dryTemp, dryTime, bedTempMin, bedTempMax,
      timestamp,
      customMessage,
      tdRaw,
      uid,
      _db: db,
    });
  }

  /**
   * Create a TigerTag Init payload.
   * Marks the chip as reserved for TigerTag without programming any material data.
   *
   * @param {Buffer} [uid] - 7-byte chip UID, if known.
   * @returns {TigerTag}
   */
  static asInit(uid = null) {
    const ts = Math.max(0, Math.floor((Date.now() - _TIGERTAG_EPOCH_MS) / 1000));
    return new TigerTag({
      idTigertag:       ID_TIGERTAG_INIT,
      idProduct:        INIT_PRODUCT_ID,
      idMaterial:       0,
      idAspect1: 0, idAspect2: 0, idType: 0, idDiameter: 0, idBrand: 0,
      color1R: 0, color1G: 0, color1B: 0, color1A: 255,
      color2R: 0, color2G: 0, color2B: 0,
      color3R: 0, color3G: 0, color3B: 0,
      measure:          0,
      idUnit:           0,
      measureAvailable: 0,
      nozzleTempMin: 0, nozzleTempMax: 0, dryTemp: 0, dryTime: 0, bedTempMin: 0, bedTempMax: 0,
      timestamp:        ts,
      customMessage:    '',
      tdRaw:            0,
      uid,
    });
  }

  /**
   * Return the 80-byte payload that wipes a TigerTag chip back to blank NDEF.
   * @returns {Buffer}
   */
  static erase() {
    return Buffer.alloc(MIN_DATA_LEN);
  }

  // ── Serializer ──────────────────────────────────────────────────────────

  /**
   * Serialize to binary (pages 0x04 onward).
   *
   * @param {boolean} [includeSignature=false] - If true, append 64-byte ECDSA signature.
   * @returns {Buffer} 80 bytes (user data) or 144 bytes (with signature).
   */
  toBytes(includeSignature = false) {
    const buf = Buffer.alloc(MIN_DATA_LEN);
    let o = 0;

    buf.writeUInt32BE(this.idTigertag >>> 0, o); o += 4;
    buf.writeUInt32BE(this.idProduct   >>> 0, o); o += 4;
    buf.writeUInt16BE(this.idMaterial & 0xFFFF, o); o += 2;
    buf[o++] = this.idAspect1 & 0xFF;
    buf[o++] = this.idAspect2 & 0xFF;
    buf[o++] = this.idType     & 0xFF;
    buf[o++] = this.idDiameter & 0xFF;
    buf.writeUInt16BE(this.idBrand & 0xFFFF, o); o += 2;

    buf[o++] = this.color1R & 0xFF;
    buf[o++] = this.color1G & 0xFF;
    buf[o++] = this.color1B & 0xFF;
    buf[o++] = this.color1A & 0xFF;

    const m = this.measure & 0xFFFFFF;
    buf[o++] = (m >> 16) & 0xFF;
    buf[o++] = (m >> 8)  & 0xFF;
    buf[o++] =  m        & 0xFF;
    buf[o++] = this.idUnit & 0xFF;

    buf.writeUInt16BE(this.nozzleTempMin & 0xFFFF, o); o += 2;
    buf.writeUInt16BE(this.nozzleTempMax & 0xFFFF, o); o += 2;
    buf[o++] = this.dryTemp    & 0xFF;
    buf[o++] = this.dryTime    & 0xFF;
    buf[o++] = this.bedTempMin & 0xFF;
    buf[o++] = this.bedTempMax & 0xFF;

    buf.writeUInt32BE(this.timestamp >>> 0, o); o += 4;

    buf[o++] = this.color2R & 0xFF;
    buf[o++] = this.color2G & 0xFF;
    buf[o++] = this.color2B & 0xFF;
    buf[o++] = 0x00;

    buf[o++] = this.color3R & 0xFF;
    buf[o++] = this.color3G & 0xFF;
    buf[o++] = this.color3B & 0xFF;
    buf[o++] = 0x00;

    buf.writeUInt16BE(this.tdRaw & 0xFFFF, o); o += 2;
    buf[o++] = 0x00;
    buf[o++] = 0x00;

    // custom_message: 28 bytes, UTF-8, zero-padded
    const msgBytes = Buffer.from(this.customMessage || '', 'utf8').subarray(0, 28);
    msgBytes.copy(buf, o);
    o += 28;

    const ma = this.measureAvailable & 0xFFFFFF;
    buf[o++] = (ma >> 16) & 0xFF;
    buf[o++] = (ma >> 8)  & 0xFF;
    buf[o++] =  ma        & 0xFF;
    buf[o++] = 0x00;

    // o === 80 at this point

    if (!includeSignature) return buf;

    const sigR = Buffer.alloc(32);
    const sigS = Buffer.alloc(32);
    if (this.signatureR) this.signatureR.copy(sigR);
    if (this.signatureS) this.signatureS.copy(sigS);
    return Buffer.concat([buf, sigR, sigS]);
  }

  // ── Patch (immutable update) ────────────────────────────────────────────

  /**
   * Return a new TigerTag with selected fields replaced.
   *
   * Protected fields (idTigertag, idProduct, uid, signatureR, signatureS)
   * cannot be modified — they are covered by the ECDSA signature.
   *
   * @param {object} kwargs - Field names (camelCase) and their new values.
   * @returns {TigerTag}
   */
  patch(kwargs) {
    const protected_ = Object.keys(kwargs).filter((k) => _PROTECTED_FIELDS.has(k));
    if (protected_.length > 0) {
      throw new Error(
        `Cannot modify protected field(s): ${protected_.sort().join(', ')}. `
        + 'These fields are covered by the ECDSA signature and must never change.',
      );
    }
    const unknown = Object.keys(kwargs).filter((k) => !_PATCHABLE_FIELDS.has(k));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown field(s): ${unknown.sort().join(', ')}. `
        + `Valid patchable fields: ${[..._PATCHABLE_FIELDS].sort().join(', ')}`,
      );
    }
    return new TigerTag(Object.assign({}, this, kwargs));
  }

  // ── Validation ──────────────────────────────────────────────────────────

  /**
   * Basic field-level sanity checks.
   * @returns {string[]} List of warning strings. Empty = no issues.
   */
  validate() {
    const warnings = [];
    if (this.nozzleTempMin > this.nozzleTempMax && this.nozzleTempMax > 0) {
      warnings.push(
        `Nozzle temp min (${this.nozzleTempMin}°C) > max (${this.nozzleTempMax}°C)`,
      );
    }
    if (this.bedTempMin > this.bedTempMax && this.bedTempMax > 0) {
      warnings.push(
        `Bed temp min (${this.bedTempMin}°C) > max (${this.bedTempMax}°C)`,
      );
    }
    if (this.tdRaw !== 0 && !(this.tdRaw >= 10 && this.tdRaw <= 1000)) {
      warnings.push(
        `TD HueForge out of range: ${this.tdRaw} (valid: 10–1000 or 0=undefined)`,
      );
    }
    if (this.measure > 0 && this.measureAvailable > this.measure) {
      warnings.push(
        `measure_available (${this.measureAvailable}) > initial measure (${this.measure})`,
      );
    }
    if (Buffer.byteLength(this.customMessage, 'utf8') > 28) {
      warnings.push('custom_message exceeds 28 bytes');
    }
    return warnings;
  }

  // ── Signature verification ──────────────────────────────────────────────

  /**
   * Verify the ECDSA-P256 signature — fully autonomous.
   *
   * Signed message: SHA-256( uid_bytes + block4 + block5 )
   *   uid_bytes = 7 raw bytes from chip pages 0-1
   *   block4    = idTigertag as 4-byte big-endian
   *   block5    = idProduct  as 4-byte big-endian
   *
   * @param {TigerTagDB} [db] - Optional pre-loaded TigerTagDB.
   * @returns {SignatureResult}
   */
  verify(db = null) {
    if (!this.isSigned) {
      return new SignatureResult(SignatureResult.UNSIGNED);
    }

    if (!this.uid) {
      return new SignatureResult(
        SignatureResult.NO_UID,
        'UID required for signature verification. '
        + 'Use fromPages(uid, payload) — the NFC SDK always exposes '
        + 'the UID separately. For binary dumps, use a full 180-byte dump.',
      );
    }

    const _db = db || this.db;
    const versionEntry = _db.version(this.idTigertag) || {};
    const pem = (versionEntry.public_key || '').trim();
    if (!pem) {
      return new SignatureResult(
        SignatureResult.NO_KEY,
        `No public_key in id_version.json for 0x${this.idTigertag.toString(16).toUpperCase().padStart(8, '0')}.`,
      );
    }

    return verifySignature({
      uid:          this.uid,
      idTigertag:   this.idTigertag,
      idProduct:    this.idProduct,
      signatureR:   this.signatureR,
      signatureS:   this.signatureS,
      publicKeyPem: pem,
    });
  }

  // ── Cloud API ───────────────────────────────────────────────────────────

  /**
   * Fetch the raw TigerTag+ cloud product data from the API.
   * Only meaningful for TigerTag+ chips (returns null for Maker/Init tags).
   *
   * @param {number} [timeout=5000] - Request timeout in milliseconds.
   * @returns {Promise<object|null>}
   */
  async rawApi(timeout = 5000) {
    if (this.isMaker || this.isInit) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const resp = await fetch(this.apiUrl, { signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (err) {
      throw new Error(
        `TigerTag+ API request failed (${err.message}). `
        + `Verify network access or browse: ${this.productPageUrl}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Compare chip data against the TigerTag+ cloud API.
   * Returns a list of ApiDiff entries for every differing field.
   * An empty list means the chip is fully in sync.
   *
   * @param {object|null} [apiData] - Pre-fetched result of rawApi(). Fetched automatically if null.
   * @param {TigerTagDB}  [db]
   * @returns {Promise<ApiDiff[]>}
   */
  async diffApi(apiData = null, db = null) {
    if (this.isMaker || this.isInit) return [];

    const _db  = db || this.db;
    const data = apiData != null ? apiData : await this.rawApi();
    if (!data) return [];

    const diffs = [];

    const _lbl = (entry) => (TigerTagDB.label(entry) || '').trim().toLowerCase();
    const _check = (field, chipVal, apiVal) => {
      if (apiVal == null) return;
      const c = String(chipVal).trim().toLowerCase();
      const a = String(apiVal).trim().toLowerCase();
      if (c !== a) diffs.push(new ApiDiff(field, chipVal, apiVal));
    };

    const fil    = data.filament || {};
    const nozzle = data.nozzle   || {};
    const bed    = data.bed      || {};
    const dryer  = data.dryer    || {};

    _check('nozzle_min', this.nozzleTempMin, nozzle.temp_min);
    _check('nozzle_max', this.nozzleTempMax, nozzle.temp_max);
    _check('bed_min',    this.bedTempMin,    bed.temp_min);
    _check('bed_max',    this.bedTempMax,    bed.temp_max);
    _check('dry_temp',   this.dryTemp,       dryer.temp);
    _check('dry_time',   this.dryTime,       dryer.time);

    _check('type',     _lbl(_db.type(this.idType)),         (data.product_type || '').toLowerCase());
    _check('material', _lbl(_db.material(this.idMaterial)), (fil.material || '').toLowerCase());
    _check('brand',    _lbl(_db.brand(this.idBrand)),       (data.brand || '').toLowerCase());
    _check('diameter', TigerTagDB.label(_db.diameter(this.idDiameter)) || '',
           String(fil.diameter || ''));

    const _EMPTY_ASPECT = new Set(['', 'unknown', '-', 'none']);
    const _checkAspect = (fname, chipId, apiVal) => {
      const chipLbl = _lbl(_db.aspect(chipId));
      const apiNorm = (apiVal || '').trim().toLowerCase();
      if (_EMPTY_ASPECT.has(chipLbl) && _EMPTY_ASPECT.has(apiNorm)) return;
      if (chipLbl !== apiNorm) diffs.push(new ApiDiff(fname, chipLbl || 'none', apiVal || 'none'));
    };
    _checkAspect('aspect_1', this.idAspect1, fil.aspect1);
    _checkAspect('aspect_2', this.idAspect2, fil.aspect2);

    const _parseApiColor = (hexStr) => {
      const h = (hexStr || '').replace('#', '');
      try {
        if (h.length === 8) return [
          parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16),
          parseInt(h.slice(4,6),16), parseInt(h.slice(6,8),16),
        ];
        if (h.length === 6) return [
          parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16),
          parseInt(h.slice(4,6),16), 255,
        ];
      } catch (_) {}
      return null;
    };

    let apiColors = [];
    const colorInfo = fil.color_info || {};
    if (colorInfo.colors && colorInfo.colors.length > 0) {
      apiColors = colorInfo.colors.filter(Boolean);
    } else if (fil.color) {
      apiColors = [fil.color];
    }

    if (apiColors.length > 0) {
      const c = _parseApiColor(apiColors[0]);
      if (c) {
        const chipHex = `#${_hex2(this.color1R)}${_hex2(this.color1G)}${_hex2(this.color1B)}${_hex2(this.color1A)}`;
        const apiHex  = `#${_hex2(c[0])}${_hex2(c[1])}${_hex2(c[2])}${_hex2(c[3])}`;
        if (chipHex.toLowerCase() !== apiHex.toLowerCase()) {
          diffs.push(new ApiDiff('color_1', chipHex, apiHex));
        }
      }
    }
    if (apiColors.length > 1) {
      const c = _parseApiColor(apiColors[1]);
      if (c) {
        const chipHex = `#${_hex2(this.color2R)}${_hex2(this.color2G)}${_hex2(this.color2B)}`;
        const apiHex  = `#${_hex2(c[0])}${_hex2(c[1])}${_hex2(c[2])}`;
        if (chipHex.toLowerCase() !== apiHex.toLowerCase()) {
          diffs.push(new ApiDiff('color_2', chipHex, apiHex));
        }
      }
    }
    if (apiColors.length > 2) {
      const c = _parseApiColor(apiColors[2]);
      if (c) {
        const chipHex = `#${_hex2(this.color3R)}${_hex2(this.color3G)}${_hex2(this.color3B)}`;
        const apiHex  = `#${_hex2(c[0])}${_hex2(c[1])}${_hex2(c[2])}`;
        if (chipHex.toLowerCase() !== apiHex.toLowerCase()) {
          diffs.push(new ApiDiff('color_3', chipHex, apiHex));
        }
      }
    }

    if (fil.grams != null) _check('measure_g', this.measure, Math.round(fil.grams));
    if (fil.measure_unit) {
      _check('measure_unit',
        TigerTagDB.label(_db.unit(this.idUnit)) || '',
        (fil.measure_unit || '').trim(),
      );
    }

    return diffs;
  }

  /**
   * Apply API-sourced field updates surgically, without touching the signature.
   *
   * @param {object|null} [apiData] - Pre-fetched API dict. If null, calls rawApi().
   * @param {TigerTagDB}  [db]
   * @returns {Promise<[TigerTag, ApiDiff[]]>}
   */
  async patchFromApi(apiData = null, db = null) {
    if (this.isMaker || this.isInit) return [this, []];

    const _db  = db || this.db;
    const data = apiData != null ? apiData : await this.rawApi();
    if (!data) return [this, []];

    const diffs = await this.diffApi(data, _db);
    if (!diffs.length) return [this, []];

    const _FIELD_MAP = {
      nozzle_min: 'nozzleTempMin',
      nozzle_max: 'nozzleTempMax',
      bed_min:    'bedTempMin',
      bed_max:    'bedTempMax',
      dry_temp:   'dryTemp',
      dry_time:   'dryTime',
      measure_g:  'measure',
    };

    const _hexToRgba = (hexStr) => {
      const h = hexStr.replace('#', '');
      try {
        if (h.length === 8) return [
          parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16),
          parseInt(h.slice(4,6),16), parseInt(h.slice(6,8),16),
        ];
        if (h.length === 6) return [
          parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16),
          parseInt(h.slice(4,6),16), 255,
        ];
      } catch (_) {}
      return null;
    };

    const updates = {};
    const applied = [];

    for (const diff of diffs) {
      if (diff.field === 'color_1' || diff.field === 'color_2' || diff.field === 'color_3') {
        const rgba = _hexToRgba(String(diff.apiValue));
        if (rgba) {
          const [r, g, b, a] = rgba;
          if (diff.field === 'color_1') Object.assign(updates, { color1R: r, color1G: g, color1B: b, color1A: a });
          else if (diff.field === 'color_2') Object.assign(updates, { color2R: r, color2G: g, color2B: b });
          else Object.assign(updates, { color3R: r, color3G: g, color3B: b });
          applied.push(diff);
        }
        continue;
      }
      const tagField = _FIELD_MAP[diff.field];
      if (tagField) {
        updates[tagField] = Math.round(Number(diff.apiValue));
        applied.push(diff);
      }
    }

    if (Object.keys(updates).length === 0) return [this, []];
    return [this.patch(updates), applied];
  }

  /**
   * Download or update reference databases.
   *
   * @param {string}  [dbPath] - Target folder. Defaults to the bundled database directory.
   * @param {boolean} [force=false] - Re-download all files even if up to date.
   * @returns {Promise<string[]>} List of filenames that were downloaded/updated.
   */
  async syncDb(dbPath = null, force = false) {
    const targetPath = dbPath || _BUNDLED_DB_PATH;
    const updated = await syncDatabases(targetPath, { force, verbose: true });
    this._db = new TigerTagDB({ dbPath: targetPath });
    return updated;
  }

  // ── Output ──────────────────────────────────────────────────────────────

  /**
   * Convert measure + measureAvailable to their canonical base unit and return
   * convenience fields ready to spread into a dict.
   *
   * Weight units  → measure_gr / measure_available_gr  (always in grams)
   * Volume units  → measure_ml / measure_available_ml  (always in millilitres)
   * Other units   → {} (no extra fields)
   *
   * id_unit mapping (from id_measure_unit.json):
   *   10 mg · 21 g · 35 kg
   *   48 ml · 62 cl · 79 L · 95 m³
   *
   * @private
   */
  /**
   * Returns a parenthetical base-unit hint string for a single value,
   * e.g. " (= 750 g)" or " (= 500 ml)".
   * Returns "" when idUnit is already the canonical base unit (g / ml / mm)
   * or unsupported (no conversion available).
   * @private
   */
  static _toBaseUnitStr(value, idUnit) {
    const BASE_IDS = new Set([21, 48, 112]); // g, ml, mm are already base
    if (BASE_IDS.has(idUnit)) return '';
    const f = TigerTag._baseUnitFields(value, value, idUnit);
    if (f.measure_gr  !== undefined) return ` (= ${f.measure_gr} g)`;
    if (f.measure_ml  !== undefined) return ` (= ${f.measure_ml} ml)`;
    if (f.measure_mm  !== undefined) return ` (= ${f.measure_mm} mm)`;
    if (f.measure_mm2 !== undefined) return ` (= ${f.measure_mm2} mm²)`;
    return '';
  }

  static _baseUnitFields(measure, measureAvailable, idUnit) {
    // Weight: mg(10) g(21) kg(35) → grams
    const WEIGHT_TO_G   = { 10: 0.001, 21: 1, 35: 1000 };
    // Volume: ml(48) cl(62) L(79) m³(95) → millilitres
    const VOLUME_TO_ML  = { 48: 1, 62: 10, 79: 1000, 95: 1_000_000 };
    // Size:   mm(112) cm(130) m(149) → millimetres
    const SIZE_TO_MM    = { 112: 1, 130: 10, 149: 1000 };
    // Area:   m²(170) → square millimetres
    const AREA_TO_MM2   = { 170: 1_000_000 };

    const wf = WEIGHT_TO_G[idUnit];
    if (wf !== undefined) {
      return {
        measure_gr:           Math.round(measure          * wf),
        measure_available_gr: Math.round(measureAvailable * wf),
      };
    }

    const vf = VOLUME_TO_ML[idUnit];
    if (vf !== undefined) {
      return {
        measure_ml:           Math.round(measure          * vf),
        measure_available_ml: Math.round(measureAvailable * vf),
      };
    }

    const sf = SIZE_TO_MM[idUnit];
    if (sf !== undefined) {
      return {
        measure_mm:           Math.round(measure          * sf),
        measure_available_mm: Math.round(measureAvailable * sf),
      };
    }

    const af = AREA_TO_MM2[idUnit];
    if (af !== undefined) {
      return {
        measure_mm2:           Math.round(measure          * af),
        measure_available_mm2: Math.round(measureAvailable * af),
      };
    }

    return {};
  }

  /**
   * Return protocol fields exactly as stored on the chip — no label resolution,
   * no unit conversion, no date formatting.
   * @returns {object}
   */
  toRawDict() {
    return {
      id_tigertag:        this.idTigertag,
      id_product:         this.idProduct,
      id_material:        this.idMaterial,
      id_aspect1:         this.idAspect1,
      id_aspect2:         this.idAspect2,
      id_type:            this.idType,
      id_diameter:        this.idDiameter,
      id_brand:           this.idBrand,
      color_r:            this.color1R,
      color_g:            this.color1G,
      color_b:            this.color1B,
      color_a:            this.color1A,
      measure:            this.measure,
      id_unit:            this.idUnit,
      nozzle_min:         this.nozzleTempMin,
      nozzle_max:         this.nozzleTempMax,
      dry_temp:           this.dryTemp,
      dry_time:           this.dryTime,
      bed_min:            this.bedTempMin,
      bed_max:            this.bedTempMax,
      timestamp:          this.timestamp,
      color_r2:           this.color2R,
      color_g2:           this.color2G,
      color_b2:           this.color2B,
      color_r3:           this.color3R,
      color_g3:           this.color3G,
      color_b3:           this.color3B,
      td_raw:             this.tdRaw,
      message:            this.customMessage,
      measure_available:  this.measureAvailable,
      ...TigerTag._baseUnitFields(this.measure, this.measureAvailable, this.idUnit),
      uid:                this.uidHex,
      product_page_url:   this.productPageUrl,
      api_url:            this.apiUrl,
      img:                this.imgUrls,
    };
  }

  // ── Write helpers ────────────────────────────────────────────────────────

  /**
   * Map a snake_case raw-dict partial object to the camelCase kwargs accepted
   * by patch(). Only keys present in the input are mapped — missing keys are
   * left untouched on the existing tag.
   *
   * Accepted keys: all keys produced by toRawDict() except uid / product_page_url / api_url.
   *
   * @param {object} raw - Partial or full toRawDict()-style object.
   * @returns {object}   - camelCase kwargs ready for patch().
   */
  static _rawDictToPatchKwargs(raw) {
    const map = {
      id_material:      'idMaterial',
      id_aspect1:       'idAspect1',
      id_aspect2:       'idAspect2',
      id_type:          'idType',
      id_diameter:      'idDiameter',
      id_brand:         'idBrand',
      color_r:          'color1R',
      color_g:          'color1G',
      color_b:          'color1B',
      color_a:          'color1A',
      color_r2:         'color2R',
      color_g2:         'color2G',
      color_b2:         'color2B',
      color_r3:         'color3R',
      color_g3:         'color3G',
      color_b3:         'color3B',
      measure:          'measure',
      measure_available:'measureAvailable',
      id_unit:          'idUnit',
      nozzle_min:       'nozzleTempMin',
      nozzle_max:       'nozzleTempMax',
      dry_temp:         'dryTemp',
      dry_time:         'dryTime',
      bed_min:          'bedTempMin',
      bed_max:          'bedTempMax',
      timestamp:        'timestamp',
      td_raw:           'tdRaw',
      message:          'customMessage',
    };
    const kwargs = {};
    for (const [snakeKey, camelKey] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(raw, snakeKey)) {
        kwargs[camelKey] = raw[snakeKey];
      }
    }
    return kwargs;
  }

  /**
   * Build a new TigerTag from a toRawDict()-style object (snake_case).
   * Useful as the first step of a write workflow: parse a stored doc, then
   * call toBytes() to get the binary payload ready for NFC write.
   *
   * Fields not present in the input fall back to safe zero / default values.
   * Protected fields (idTigertag, idProduct) can optionally be supplied.
   *
   * @param {object} raw - toRawDict()-style object.
   * @param {TigerTagDB} [db]
   * @returns {TigerTag}
   */
  static fromRawDict(raw, db = null) {
    return TigerTag.create({
      productId:    raw.id_product  ?? MAKER_PRODUCT_ID,
      idMaterial:   raw.id_material ?? 0,
      idAspect1:    raw.id_aspect1  ?? 0,
      idAspect2:    raw.id_aspect2  ?? 0,
      idType:       raw.id_type     ?? 0,
      idDiameter:   raw.id_diameter ?? 0,
      idBrand:      raw.id_brand    ?? 0,
      color1R:      raw.color_r     ?? 0,
      color1G:      raw.color_g     ?? 0,
      color1B:      raw.color_b     ?? 0,
      color1A:      raw.color_a     ?? 255,
      color2R:      raw.color_r2    ?? 0,
      color2G:      raw.color_g2    ?? 0,
      color2B:      raw.color_b2    ?? 0,
      color3R:      raw.color_r3    ?? 0,
      color3G:      raw.color_g3    ?? 0,
      color3B:      raw.color_b3    ?? 0,
      measure:      raw.measure     ?? 0,
      measureAvailable: raw.measure_available ?? raw.measure ?? 0,
      idUnit:       raw.id_unit     ?? 0,
      nozzleTempMin: raw.nozzle_min ?? 0,
      nozzleTempMax: raw.nozzle_max ?? 0,
      dryTemp:      raw.dry_temp    ?? 0,
      dryTime:      raw.dry_time    ?? 0,
      bedTempMin:   raw.bed_min     ?? 0,
      bedTempMax:   raw.bed_max     ?? 0,
      timestamp:    raw.timestamp   ?? null,
      customMessage: raw.message    ?? '',
      tdRaw:        raw.td_raw      ?? 0,
      db,
    });
  }

  /**
   * Build a new TigerTag from a Firestore cloud document.
   * The cloud format uses data1–data7 for the temperature/diameter fields
   * and weight_available / measure_gr for available weight.
   *
   * @param {object} doc - Firestore document data object.
   * @param {TigerTagDB} [db]
   * @returns {TigerTag}
   */
  static fromCloudDoc(doc, db = null) {
    return TigerTag.create({
      productId:    doc.id_product  ?? MAKER_PRODUCT_ID,
      idMaterial:   doc.id_material ?? 0,
      idAspect1:    doc.id_aspect1  ?? 0,
      idAspect2:    doc.id_aspect2  ?? 0,
      idType:       doc.id_type     ?? 0,
      idDiameter:   doc.data1       ?? 0,   // data1 = id_diameter
      idBrand:      doc.id_brand    ?? 0,
      color1R:      doc.color_r     ?? 0,
      color1G:      doc.color_g     ?? 0,
      color1B:      doc.color_b     ?? 0,
      color1A:      doc.color_a     ?? 255,
      color2R:      doc.color_r2    ?? 0,
      color2G:      doc.color_g2    ?? 0,
      color2B:      doc.color_b2    ?? 0,
      color3R:      doc.color_r3    ?? 0,
      color3G:      doc.color_g3    ?? 0,
      color3B:      doc.color_b3    ?? 0,
      measure:      doc.measure     ?? 0,
      measureAvailable: doc.weight_available ?? doc.measure_gr ?? doc.measure ?? 0,
      idUnit:       doc.id_unit     ?? 0,
      nozzleTempMin: doc.data2      ?? 0,   // data2 = nozzle_min
      nozzleTempMax: doc.data3      ?? 0,   // data3 = nozzle_max
      dryTemp:      doc.data4       ?? 0,   // data4 = dry_temp
      dryTime:      doc.data5       ?? 0,   // data5 = dry_time
      bedTempMin:   doc.data6       ?? 0,   // data6 = bed_min
      bedTempMax:   doc.data7       ?? 0,   // data7 = bed_max
      timestamp:    doc.timestamp   ?? null,
      customMessage: doc.message    ?? '',
      // Firestore stores TD as a human-readable float (e.g. 1.5).
      // The chip encodes tdRaw = round(tdValue × 10) as a UInt16.
      tdRaw:        doc.TD != null ? Math.round(doc.TD * 10) : 0,
      db,
    });
  }

  /**
   * Apply a surgical patch using snake_case keys (toRawDict format).
   * Only the supplied keys are changed — all other fields are preserved.
   *
   * Examples:
   *   tag.patchFromRawDict({ td_raw: 150 })
   *   tag.patchFromRawDict({ message: "Opened 2025-01", measure_available: 750 })
   *   tag.patchFromRawDict({ td_raw: 0, message: "", nozzle_min: 220 })
   *
   * @param {object} raw - Partial toRawDict()-style object.
   * @returns {TigerTag}  New patched instance (immutable).
   */
  patchFromRawDict(raw) {
    return this.patch(TigerTag._rawDictToPatchKwargs(raw));
  }

  /**
   * Return a fully-resolved object with labels, units, and semantic context.
   * Suitable for JSON serialization, API responses, or LLM context injection.
   *
   * @param {TigerTagDB} [db]
   * @returns {object}
   */
  toDict(db = null) {
    const _db       = db || this.db;
    const mat       = _db.material(this.idMaterial) || {};
    const rec       = mat.recommended || {};
    const stock     = this.stockPercent;
    const unitLabel = TigerTagDB.label(_db.unit(this.idUnit));

    return {
      sdk:      'tigertag-sdk-js',
      sdk_mode: 'offline',
      protocol: 'TigerTag Open Source v2.1',
      chip:     'NTAG213/215/216',
      uid:      this.uidHex,
      version: {
        id:    this.idTigertag,
        hex:   `0x${this.idTigertag.toString(16).toUpperCase().padStart(8, '0')}`,
        label: TigerTagDB.label(_db.version(this.idTigertag)),
      },
      product: {
        id:   this.idProduct,
        mode: this.isMaker ? 'maker' : this.isInit ? 'init' : 'cloud',
        description: this.isMaker
          ? 'TigerTag Maker — all data stored on chip, no cloud dependency.'
          : this.isInit
            ? 'TigerTag Init — blank/uninitialized chip.'
            : `TigerTag+ — cloud product ID ${this.idProduct}. `
              + 'Query the api_url field for the full enriched product JSON.',
        product_page_url: this.productPageUrl,
        api_url:          this.apiUrl,
        img:              this.imgUrls,
      },
      material: {
        id:       this.idMaterial,
        label:    TigerTagDB.label(_db.material(this.idMaterial)),
        density:  mat.density,
        density_unit: 'g/cm³',
        filled:   mat.filled,
        recommended_by_db: rec.nozzleTempMin != null ? {
          nozzle: { min: rec.nozzleTempMin, max: rec.nozzleTempMax, unit: 'celsius' },
          bed:    { min: rec.bedTempMin,    max: rec.bedTempMax,    unit: 'celsius' },
          dry:    { temp: rec.dryTemp, time_h: rec.dryTime, temp_unit: 'celsius', time_unit: 'hours' },
        } : null,
        metadata: mat.metadata,
      },
      aspect_1: {
        id:          this.idAspect1,
        label:       TigerTagDB.label(_db.aspect(this.idAspect1)),
        color_count: (_db.aspect(this.idAspect1) || {}).color_count || 1,
      },
      aspect_2: {
        id:          this.idAspect2,
        label:       TigerTagDB.label(_db.aspect(this.idAspect2)),
        color_count: (_db.aspect(this.idAspect2) || {}).color_count || 1,
        description: 'Check aspect_2 first for multi-color modes (Bicolor/Tricolor/Rainbow). '
          + 'color_count defines how many of the three color fields are active.',
      },
      type:     { id: this.idType,     label: TigerTagDB.label(_db.type(this.idType)) },
      diameter: { id: this.idDiameter, label: TigerTagDB.label(_db.diameter(this.idDiameter)), unit: 'mm' },
      brand:    { id: this.idBrand,    label: TigerTagDB.label(_db.brand(this.idBrand)) },
      colors: {
        primary:   {
          hex:  this.color1Hex,
          rgba: [this.color1R, this.color1G, this.color1B, this.color1A],
          description: 'Main filament color (RGBA — alpha=255 means fully opaque).',
        },
        secondary: {
          hex: this.color2Hex,
          rgb: [this.color2R, this.color2G, this.color2B],
          description: 'Secondary color for bi-color or gradient filaments.',
        },
        tertiary: {
          hex: this.color3Hex,
          rgb: [this.color3R, this.color3G, this.color3B],
          description: 'Tertiary color for tri-color filaments.',
        },
      },
      hueforge_td: {
        value:       this.tdRaw !== 0 ? this.tdValue : null,
        unit:        'TD (Transmission Distance)',
        description: 'HueForge Transmission Distance — opacity parameter for image-to-model slicing. '
          + 'Valid range: 0.1–100.0. null means undefined (no HueForge data on this tag).',
      },
      measure: {
        initial:     this.measure,
        available:   this.measureAvailable,
        ...TigerTag._baseUnitFields(this.measure, this.measureAvailable, this.idUnit),
        percent:     stock,
        unit:        unitLabel,
        description: `Material quantity: ${this.measureAvailable} ${unitLabel} remaining `
          + `out of ${this.measure} ${unitLabel} initial `
          + (stock != null ? `(${stock}%).` : '(percentage unavailable).'),
      },
      temperatures: {
        unit: 'celsius',
        on_chip: {
          description: 'Settings programmed by the manufacturer on the chip.',
          nozzle: { min: this.nozzleTempMin, max: this.nozzleTempMax },
          bed:    { min: this.bedTempMin,    max: this.bedTempMax },
          dry:    { temp: this.dryTemp,      time_h: this.dryTime },
        },
      },
      manufacturing_date:  this.manufacturingDate.toISOString(),
      twin_tag_pairing_id: this.timestamp,
      custom_message:      this.customMessage,
      authentication: {
        signed:      this.isSigned,
        uid_present: this.uid != null,
        description: this.isSigned
          ? 'Tag carries an ECDSA-P256 signature. Call tag.verify() to check authenticity.'
          : 'Tag is not signed — authenticity cannot be verified cryptographically.',
      },
    };
  }

  /**
   * Return a concise natural-language description of the tag.
   * Designed for injection into LLM prompts.
   *
   * @param {TigerTagDB} [db]
   * @returns {string}
   */
  describe(db = null) {
    const _db = db || this.db;
    const mat = _db.material(this.idMaterial) || {};
    const rec = mat.recommended || {};

    const material = TigerTagDB.label(_db.material(this.idMaterial));
    const type_    = TigerTagDB.label(_db.type(this.idType));
    const diameter = TigerTagDB.label(_db.diameter(this.idDiameter));
    const brand    = TigerTagDB.label(_db.brand(this.idBrand));
    const unit     = TigerTagDB.label(_db.unit(this.idUnit));
    const density  = mat.density;
    const stock    = this.stockPercent;

    const asp2Entry  = _db.aspect(this.idAspect2);
    const asp1Entry  = _db.aspect(this.idAspect1);
    let colorCount   = 1;
    if (asp2Entry && (asp2Entry.color_count || 1) > 1) colorCount = asp2Entry.color_count;
    else if (asp1Entry && (asp1Entry.color_count || 1) > 1) colorCount = asp1Entry.color_count;

    const aspect1Label = TigerTagDB.label(asp1Entry);
    const aspect2Label = TigerTagDB.label(asp2Entry);

    const parts = [];

    parts.push(
      `TigerTag RFID chip read successfully.`
      + ` Material: ${material} ${type_}`
      + (!['Unknown', '-'].includes(diameter) ? ` (${diameter}mm diameter)` : '')
      + (density ? `, density ${density} g/cm³` : '')
      + (!['Unknown', '-'].includes(brand) ? `, by ${brand}` : '')
      + '.',
    );

    const finishParts = [aspect1Label, aspect2Label].filter(
      (l) => !['Unknown', '-', 'None'].includes(l),
    );
    if (finishParts.length > 0) parts.push(`Finish: ${finishParts.join(' + ')}.`);

    const colorParts = [`primary ${this.color1Hex}`];
    if (colorCount >= 2) colorParts.push(`secondary ${this.color2Hex}`);
    if (colorCount >= 3) colorParts.push(`tertiary ${this.color3Hex}`);
    parts.push(`Color: ${colorParts.join(', ')}.`);

    parts.push(
      `Print settings (on chip): nozzle ${this.nozzleTempMin}–${this.nozzleTempMax}°C,`
      + ` bed ${this.bedTempMin}–${this.bedTempMax}°C,`
      + ` drying ${this.dryTemp}°C for ${this.dryTime}h.`,
    );

    if (rec.nozzleTempMin != null) {
      parts.push(
        `Database recommended settings: nozzle ${rec.nozzleTempMin}–${rec.nozzleTempMax}°C,`
        + ` bed ${rec.bedTempMin || '?'}–${rec.bedTempMax || '?'}°C,`
        + ` drying ${rec.dryTemp || '?'}°C for ${rec.dryTime || '?'}h.`,
      );
    }

    if (this.measure > 0) {
      const BASE_UNIT_IDS = new Set([21, 48, 112]); // g, ml, mm — already canonical
      const bf    = BASE_UNIT_IDS.has(this.idUnit)
        ? {}
        : TigerTag._baseUnitFields(this.measure, this.measureAvailable, this.idUnit);
      const buKey = Object.keys(bf).find(k => k.startsWith('measure_available_'));
      const buUnit = buKey ? buKey.replace('measure_available_', '') : null;
      // buUnit is 'gr'→'g', 'ml', 'mm', 'mm2'→'mm²'
      const buLabel = buUnit ? buUnit.replace('gr', 'g').replace('mm2', 'mm²') : null;
      const buNote  = buLabel
        ? ` — ${bf['measure_available_' + buUnit]} ${buLabel} available, `
          + `${bf['measure_' + buUnit]} ${buLabel} total`
        : '';
      parts.push(
        `Quantity: ${this.measureAvailable} ${unit} remaining`
        + ` out of ${this.measure} ${unit} initial`
        + (stock != null ? ` (${stock}%${buNote}).` : (buNote ? `${buNote}.` : '.')),
      );
    }

    if (this.tdRaw !== 0) parts.push(`HueForge TD: ${this.tdValue.toFixed(1)}.`);

    const dateStr = this.manufacturingDate.toISOString().slice(0, 10);
    parts.push(`Manufactured: ${dateStr}.`);
    if (this.customMessage) parts.push(`Custom message on chip: "${this.customMessage}".`);
    if (this.uidHex) parts.push(`Chip UID: ${this.uidHex}.`);

    if (this.productPageUrl) {
      parts.push(
        `Product page: ${this.productPageUrl} — API JSON: ${this.apiUrl}`,
      );
    }

    const imgs = this.imgUrls; // snapshot — single Date.now() for this describe() call
    if (imgs) {
      parts.push(
        `Product image (medium 256×256): ${imgs.medium}`
        + ` — also available: icon·16 thumb·32 small·64 compact·128 large·512 master·1024.`,
      );
    }

    if (this.isSigned) {
      parts.push('Tag carries an ECDSA-P256 signature — call tag.verify() to confirm authenticity.');
    } else {
      parts.push('Tag is not ECDSA-signed.');
    }

    return parts.join(' ');
  }

  /**
   * Human-readable summary of the tag contents.
   *
   * @param {TigerTagDB}       [db]
   * @param {SignatureResult}  [sigResult]
   * @returns {string}
   */
  pretty(db = null, sigResult = null) {
    const _db   = db || this.db;
    const mat   = _db.material(this.idMaterial) || {};
    const rec   = mat.recommended || {};
    const stock = this.stockPercent;
    const ul    = TigerTagDB.label(_db.unit(this.idUnit));
    const sig   = sigResult
      ? String(sigResult)
      : (this.isSigned ? 'signed ✓' : 'not signed');

    const recNote = (kMin, kMax, suffix = '°C') =>
      rec[kMin] != null ? `  (DB: ${rec[kMin]}–${rec[kMax]}${suffix})` : '';

    const idHex = this.idTigertag.toString(16).toUpperCase().padStart(8, '0');
    const imgs  = this.imgUrls; // snapshot — single Date.now() for the whole render

    return (
      `┌─ TigerTag ────────────────────────────────────────────\n`
      + `│  Version      ${TigerTagDB.label(_db.version(this.idTigertag))} (0x${idHex})\n`
      + `│  Product      ${this.isMaker ? 'TigerTag Maker' : this.isInit ? 'TigerTag Init' : `TigerTag+ (cloud #${this.idProduct})`}\n`
      + `│  UID          ${this.uidHex || '— (partial dump)'}\n`
      + (this.productPageUrl
        ? `│  Product page ${this.productPageUrl}\n│  API JSON     ${this.apiUrl}\n`
        : '')
      + (imgs
        ? `│  Image (med)  ${imgs.medium}\n`
          + `│  Img sizes    icon·16 thumb·32 small·64 compact·128 medium·256 large·512 master·1024\n`
        : '')
      + `├─ Material ────────────────────────────────────────────\n`
      + `│  Material     ${TigerTagDB.label(_db.material(this.idMaterial))}  (id=${this.idMaterial})\n`
      + `│  Density      ${mat.density != null ? mat.density : '—'} g/cm³\n`
      + `│  Type         ${TigerTagDB.label(_db.type(this.idType))}\n`
      + `│  Diameter     ${TigerTagDB.label(_db.diameter(this.idDiameter))}\n`
      + `│  Brand        ${TigerTagDB.label(_db.brand(this.idBrand))}\n`
      + `│  Aspect 1     ${TigerTagDB.label(_db.aspect(this.idAspect1))}\n`
      + `│  Aspect 2     ${TigerTagDB.label(_db.aspect(this.idAspect2))}\n`
      + `├─ Colors ──────────────────────────────────────────────\n`
      + `│  Color 1      ${this.color1Hex}  α=${this.color1A}\n`
      + `│  Color 2      ${this.color2Hex}\n`
      + `│  Color 3      ${this.color3Hex}\n`
      + `│  HueForge TD  ${this.tdValue.toFixed(1)}${this.tdRaw === 0 ? ' (undefined)' : ''}\n`
      + `├─ Temperatures ────────────────────────────────────────\n`
      + `│  Nozzle       ${this.nozzleTempMin}°C → ${this.nozzleTempMax}°C${recNote('nozzleTempMin', 'nozzleTempMax')}\n`
      + `│  Bed          ${this.bedTempMin}°C → ${this.bedTempMax}°C${recNote('bedTempMin', 'bedTempMax')}\n`
      + `│  Drying       ${this.dryTemp}°C / ${this.dryTime}h${recNote('dryTemp', 'dryTime', ' h')}\n`
      + `├─ Quantity ────────────────────────────────────────────\n`
      + `│  Unit         ${ul}\n`
      + `│  Initial      ${this.measure} ${ul}${TigerTag._toBaseUnitStr(this.measure, this.idUnit)}\n`
      + `│  Available    ${this.measureAvailable} ${ul}${TigerTag._toBaseUnitStr(this.measureAvailable, this.idUnit)}`
      + (stock != null ? `  (${stock}% remaining)\n` : '\n')
      + `├─ Traceability ────────────────────────────────────────\n`
      + `│  Manufactured ${this.manufacturingDate.toISOString().replace('T', ' ').slice(0, 16)} UTC\n`
      + `│  Twin tag ID  ${this.timestamp}\n`
      + `│  Message      ${JSON.stringify(this.customMessage)}\n`
      + `├─ Signature ───────────────────────────────────────────\n`
      + `│  ECDSA        ${sig}\n`
      + `└───────────────────────────────────────────────────────`
    );
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function _hex2(n) {
  return (n & 0xFF).toString(16).padStart(2, '0').toUpperCase();
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
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
};
