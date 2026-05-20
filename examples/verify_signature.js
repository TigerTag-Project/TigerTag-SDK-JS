/**
 * verify_signature.js — ECDSA signature verification example.
 *
 * Demonstrates the full sign → verify flow with an ephemeral key pair.
 * In production, the public key lives in database/id_version.json
 * (bundled in the package and used automatically by tag.verify()).
 *
 * Run:
 *   node examples/verify_signature.js
 */

'use strict';

const path = require('path');
const {
  generateKeyPairSync,
  createSign,
  createVerify,
} = require('crypto');

// When installed via npm, use: const { TigerTag, TigerTagDB, SignatureResult } = require('tigertag');
const { TigerTag, TigerTagDB, SignatureResult } = require(path.join(__dirname, '..', 'src', 'index'));

function makeUnsignedPayload(idTigertag, idProduct) {
  const buf = Buffer.alloc(80);
  let o = 0;
  const p32 = (v) => { buf.writeUInt32BE(v >>> 0, o); o += 4; };
  const p16 = (v) => { buf.writeUInt16BE(v & 0xFFFF, o); o += 2; };
  const p24 = (v) => { buf[o++] = (v >> 16) & 0xFF; buf[o++] = (v >> 8) & 0xFF; buf[o++] = v & 0xFF; };
  const p8  = (v) => { buf[o++] = v & 0xFF; };

  p32(idTigertag);
  p32(idProduct);
  p16(38219);                          // PLA
  p8(1); p8(0); p8(0x8E); p8(0x38);   // aspect1, aspect2, type, diameter
  p16(1);                              // brand
  p8(255); p8(50); p8(50); p8(255);   // color1 RGBA
  p24(1000); p8(1);                    // measure, unit
  p16(190); p16(220);                  // nozzle min/max
  p8(65); p8(8); p8(60); p8(70);      // dryTemp, dryTime, bedMin, bedMax
  p32(756864000);                      // timestamp
  p8(50); p8(255); p8(50); p8(0);     // color2 RGB + pad
  p8(50); p8(50); p8(255); p8(0);     // color3 RGB + pad
  p16(0); p16(0);                      // tdRaw, pad
  Buffer.from('Signed spool').copy(buf, o, 0, 12);
  o += 28;                             // customMessage
  p24(1000); p8(0);                    // measureAvailable, pad

  return buf;
}

/**
 * Parse a DER-encoded ECDSA signature and extract raw (r, s) as Buffer(32) each.
 */
function derToRawRS(der) {
  let pos = 0;
  if (der[pos++] !== 0x30) throw new Error('Expected SEQUENCE');
  // skip length (may be long-form)
  if (der[pos] & 0x80) pos += (der[pos] & 0x7F) + 1; else pos++;

  const readInt = () => {
    if (der[pos++] !== 0x02) throw new Error('Expected INTEGER');
    const len = der[pos++];
    let val = der.subarray(pos, pos + len);
    pos += len;
    // strip leading 0x00 padding byte
    if (val[0] === 0x00) val = val.subarray(1);
    // pad to 32 bytes
    const out = Buffer.alloc(32);
    val.copy(out, 32 - val.length);
    return out;
  };

  return { r: readInt(), s: readInt() };
}

function main() {
  const uid         = Buffer.from('04A1B2C3D4E5F6', 'hex');
  const idTigertag  = 0x01000001;
  const idProduct   = 0xFFFFFFFF;

  // ── Generate an ephemeral key pair ──────────────────────────────────────────
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = publicKey.export({ type: 'spki', format: 'pem' });

  console.log('Generated ephemeral ECDSA-P256 key pair.');
  console.log();

  // ── Build the signed payload ─────────────────────────────────────────────────
  const payload  = makeUnsignedPayload(idTigertag, idProduct);
  const block4   = Buffer.allocUnsafe(4); block4.writeUInt32BE(idTigertag >>> 0, 0);
  const block5   = Buffer.allocUnsafe(4); block5.writeUInt32BE(idProduct  >>> 0, 0);
  const message  = Buffer.concat([uid, block4, block5]);  // 15 bytes

  const sign = createSign('SHA256');
  sign.update(message);
  const derSig = sign.sign(privateKey);

  const { r: sigR, s: sigS } = derToRawRS(derSig);
  const signedPayload = Buffer.concat([payload, sigR, sigS]);  // 144 bytes

  // ── Parse and verify ─────────────────────────────────────────────────────────
  const tag = TigerTag.fromPages(uid, signedPayload);

  // Inject the test public key into a DB instance
  const db = new TigerTagDB();
  db._versions = [{ id: idTigertag, label: 'test-key', public_key: pem }];

  const result = tag.verify(db);

  console.log(`Tag is signed:       ${tag.isSigned}`);
  console.log(`Verification result: ${result}`);
  console.log(`result.ok:           ${result.ok}`);
  console.log();

  // ── Tamper the signature — should fail ───────────────────────────────────────
  const tamperedR       = Buffer.from(sigR.map(b => b ^ 0xFF));
  const tamperedPayload = Buffer.concat([payload, tamperedR, sigS]);
  const tamperedTag     = TigerTag.fromPages(uid, tamperedPayload);
  const tamperedResult  = tamperedTag.verify(db);

  console.log(`Tampered result:     ${tamperedResult}`);
  console.log(`tampered.ok:         ${tamperedResult.ok}`);
  console.log();

  // ── Unsigned tag ─────────────────────────────────────────────────────────────
  const unsignedTag    = TigerTag.fromPages(uid, payload);
  const unsignedResult = new SignatureResult(SignatureResult.UNSIGNED);
  console.log(`Unsigned result:     ${unsignedResult}`);
  console.log(`unsigned.ok:         ${unsignedResult.ok}`);
}

main();
