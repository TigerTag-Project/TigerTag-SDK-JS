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
 * ECDSA-P256 signature verification for TigerTag chips.
 */

const { createVerify } = require('crypto');

/**
 * Convert raw ECDSA (r, s) components to DER-encoded signature.
 * Node.js crypto.createVerify() requires DER format.
 * @param {Buffer} r - 32-byte R component
 * @param {Buffer} s - 32-byte S component
 * @returns {Buffer} DER-encoded signature
 */
function ecdsaRawToDer(r, s) {
  const encodeInt = (buf) => {
    let b = buf;
    while (b.length > 1 && b[0] === 0) b = b.subarray(1);
    if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0x00]), b]);
    return Buffer.concat([Buffer.from([0x02, b.length]), b]);
  };
  const rb = encodeInt(r);
  const sb = encodeInt(s);
  const seq = Buffer.concat([rb, sb]);
  return Buffer.concat([Buffer.from([0x30, seq.length]), seq]);
}

/**
 * Result of an ECDSA signature verification.
 *
 * @property {string} status - One of the class constants (VALID, INVALID, UNSIGNED, …)
 * @property {boolean} ok    - True only when status === VALID
 * @property {string} detail - Human-readable explanation for failures
 */
class SignatureResult {
  /**
   * @param {string} status
   * @param {string} [detail]
   */
  constructor(status, detail = '') {
    this.status = status;
    this.detail = detail;
    this.ok = status === SignatureResult.VALID;
  }

  toString() {
    const base = SignatureResult._ICONS[this.status] || `? ${this.status}`;
    return this.detail ? `${base}  ${this.detail}` : base;
  }

  /**
   * Serialize to a plain object for JSON output.
   * @returns {{ status: string, ok: boolean, detail: string }}
   */
  toDict() {
    return { status: this.status, ok: this.ok, detail: this.detail };
  }
}

SignatureResult.VALID     = 'valid';
SignatureResult.INVALID   = 'invalid';
SignatureResult.UNSIGNED  = 'unsigned';
SignatureResult.NO_CRYPTO = 'no_crypto';
SignatureResult.NO_KEY    = 'no_key';
SignatureResult.NO_UID    = 'no_uid';

SignatureResult._ICONS = {
  valid:     '✅ VALID',
  invalid:   '❌ INVALID',
  unsigned:  '⬜ NOT SIGNED',
  no_crypto: '⚠️  crypto not available',
  no_key:    '⚠️  public key not found in id_version.json',
  no_uid:    '⚠️  UID unavailable — provide a full 180-byte chip dump',
};

/**
 * Verify an ECDSA-P256 signature against TigerTag data.
 *
 * Signed message: SHA-256( uid_bytes + block4 + block5 )
 *   uid_bytes = 7 raw bytes from chip pages 0-1 (ISO 14443, raw binary)
 *   block4    = id_tigertag as 4-byte big-endian (page 0x04)
 *   block5    = id_product  as 4-byte big-endian (page 0x05)
 *
 * @param {object} params
 * @param {Buffer} params.uid            - 7-byte chip UID (raw bytes, not hex)
 * @param {number} params.idTigertag     - TigerTag version/format identifier
 * @param {number} params.idProduct      - Product ID
 * @param {Buffer} params.signatureR     - 32-byte ECDSA R component
 * @param {Buffer} params.signatureS     - 32-byte ECDSA S component
 * @param {string} params.publicKeyPem   - PEM-encoded ECDSA-P256 public key
 * @returns {SignatureResult}
 */
function verifySignature({ uid, idTigertag, idProduct, signatureR, signatureS, publicKeyPem }) {
  try {
    const block4 = Buffer.alloc(4);
    block4.writeUInt32BE(idTigertag >>> 0, 0);
    const block5 = Buffer.alloc(4);
    block5.writeUInt32BE(idProduct >>> 0, 0);
    const message = Buffer.concat([uid, block4, block5]);

    const der = ecdsaRawToDer(signatureR, signatureS);
    const verify = createVerify('SHA256');
    verify.update(message);
    const valid = verify.verify({ key: publicKeyPem, format: 'pem', type: 'spki' }, der);

    if (valid) return new SignatureResult(SignatureResult.VALID);
    return new SignatureResult(
      SignatureResult.INVALID,
      'Signature does not match — tag may be cloned or tampered.',
    );
  } catch (err) {
    if (err.message && /invalid signature|bad signature|wrong signature/i.test(err.message)) {
      return new SignatureResult(
        SignatureResult.INVALID,
        'Signature does not match — tag may be cloned or tampered.',
      );
    }
    return new SignatureResult(SignatureResult.INVALID, `Verification error: ${err.message}`);
  }
}

module.exports = { SignatureResult, verifySignature, ecdsaRawToDer };
