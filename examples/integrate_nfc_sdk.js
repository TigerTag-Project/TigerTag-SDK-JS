/**
 * integrate_nfc_sdk.js — NFC SDK integration patterns.
 *
 * Shows how to adapt output from various NFC SDKs into TigerTag.fromPages().
 * All platform-specific sections are commented pseudocode; the Node.js section
 * at the bottom is runnable as a simulation.
 *
 * TigerTag stores all material data on the chip — no network required.
 * Read pages 0x04–0x27 (36 pages × 4 bytes = 144 bytes) and pass them
 * along with the 7-byte UID to TigerTag.fromPages().
 *
 * Run:
 *   node examples/integrate_nfc_sdk.js
 */

'use strict';

const path = require('path');
// When installed via npm, use: const { TigerTag } = require('tigertag');
const { TigerTag } = require(path.join(__dirname, '..', 'src', 'index'));

// =============================================================================
// ANDROID — NfcA / MifareUltralight
// =============================================================================
//
// Kotlin / Java:
//
//   val tag: Tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
//   val uid: ByteArray = tag.id                     // 7 bytes
//   val mifare = MifareUltralight.get(tag)
//   mifare.connect()
//   // Read 36 pages starting at page 4 (144 bytes total)
//   // MifareUltralight.readPages() reads 4 pages at once (16 bytes)
//   var payload = ByteArray(0)
//   for (page in 4 until 40 step 4) {
//       payload += mifare.readPages(page)
//   }
//   mifare.close()
//
//   // In a Kotlin/JS or bridge context:
//   val tag = TigerTag.fromPages(payload, uid)


// =============================================================================
// iOS — CoreNFC (Swift)
// =============================================================================
//
//   func tagReaderSession(_ session: NFCTagReaderSession,
//                         didDetect tags: [NFCTag]) {
//       guard case .miFare(let mifareTag) = tags.first else { return }
//       session.connect(to: tags.first!) { _ in
//           let uid = Data(mifareTag.identifier)    // 7 bytes
//           var payload = Data()
//           // Read pages 4-39 (144 bytes), 4 pages at a time
//           // Use NTAG READ command (0x30) for each batch
//           // … collect 36 pages × 4 bytes = 144 bytes
//
//           // Pass to TigerTag (via React Native, Capacitor, or a Node.js bridge):
//           // tag = TigerTag.fromPages(Buffer.from(payload), Buffer.from(uid))
//       }
//   }


// =============================================================================
// Flutter — flutter_nfc_kit
// =============================================================================
//
//   final nfcTag = await FlutterNfcKit.poll(
//       timeout: Duration(seconds: 10),
//   );
//   final uidHex = nfcTag.id;   // e.g. "04A1B2C3D4E5F6"
//   // Read pages 4 to 39, 4 pages per NTAG READ command (0x30)
//   var payload = Uint8List(0);
//   for (int page = 4; page < 40; page += 4) {
//       final chunk = await FlutterNfcKit.transceive(
//           Uint8List.fromList([0x30, page]),
//       );
//       payload = Uint8List.fromList([...payload, ...chunk.sublist(0, 16)]);
//   }
//   await FlutterNfcKit.finish();
//
//   // In a Dart↔JS bridge or Node.js Dart interop:
//   // const uid     = Buffer.from(uidHex, 'hex');
//   // const tag     = TigerTag.fromPages(Buffer.from(payload), uid);


// =============================================================================
// Node.js — nfc-pcsc (ACR122U / PN532)
// =============================================================================
//
//   const { NFC } = require('nfc-pcsc');
//   const { TigerTag } = require('tigertag');
//
//   const nfc = new NFC();
//
//   nfc.on('reader', (reader) => {
//       reader.on('card', async (card) => {
//           try {
//               const uid = Buffer.from(card.uid, 'hex');    // 7 bytes
//
//               // Read pages 4–39: 36 pages × 4 bytes = 144 bytes
//               // nfc-pcsc read(startPage, length, pageSize)
//               const payload = await reader.read(4, 144, 4);
//
//               const tag = TigerTag.fromPages(payload, uid);
//               console.log(tag.pretty());
//               console.log(String(tag.verify()));
//           } catch (err) {
//               console.error('Read error:', err.message);
//           }
//       });
//   });
//
//   nfc.on('error', (err) => console.error('NFC error:', err));


// =============================================================================
// Electron — main process (replace parseTigerTag subprocess)
// =============================================================================
//
//   // main.js
//   const { TigerTag, TigerTagDB } = require('tigertag');
//
//   // Called from your NFC reader callback
//   function parseTigerTag(payload, uid) {
//       const tag = TigerTag.fromPages(Buffer.from(payload), Buffer.from(uid));
//       const db  = new TigerTagDB();
//       return {
//           dict: tag.toDict(db),
//           raw:  tag.toRawDict(),
//           sig:  tag.verify(db).toDict(),
//       };
//   }
//
//   ipcMain.handle('parse-tag', async (event, { payload, uid }) => {
//       return parseTigerTag(payload, uid);
//   });


// =============================================================================
// Arduino — MFRC522 (send to Node.js over Serial)
// =============================================================================
//
//   #include <MFRC522.h>
//   MFRC522 mfrc522(SS_PIN, RST_PIN);
//   mfrc522.PCD_Init();
//
//   if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
//     byte uid[7];
//     memcpy(uid, mfrc522.uid.uidByte, 7);
//     byte payload[144];
//     for (byte page = 4; page < 40; page++) {
//       byte buf[18]; byte bufSize = sizeof(buf);
//       mfrc522.MIFARE_Read(page, buf, &bufSize);
//       memcpy(payload + (page - 4) * 4, buf, 4);
//     }
//     // Send uid (7B) + payload (144B) over Serial in binary
//     Serial.write(uid, 7);
//     Serial.write(payload, 144);
//   }
//
//   // Node.js side (SerialPort library):
//   // const { TigerTag } = require('tigertag');
//   // port.on('data', (data) => {
//   //     const uid     = data.subarray(0, 7);
//   //     const payload = data.subarray(7, 151);
//   //     const tag     = TigerTag.fromPages(payload, uid);
//   //     console.log(tag.pretty());
//   // });


// =============================================================================
// Node.js simulation — runs directly
// =============================================================================

function makeDemoPayload() {
  const buf = Buffer.alloc(80);
  let o = 0;
  const p32 = (v) => { buf.writeUInt32BE(v >>> 0, o); o += 4; };
  const p16 = (v) => { buf.writeUInt16BE(v & 0xFFFF, o); o += 2; };
  const p24 = (v) => { buf[o++] = (v >> 16) & 0xFF; buf[o++] = (v >> 8) & 0xFF; buf[o++] = v & 0xFF; };
  const p8  = (v) => { buf[o++] = v & 0xFF; };

  p32(0x01000001);                     // idTigertag
  p32(0xFFFFFFFF);                     // idProduct — Maker
  p16(38219);                          // PLA
  p8(1); p8(0); p8(0x8E); p8(0x38);   // aspect1, aspect2, type, diameter
  p16(1);                              // brand
  p8(255); p8(128); p8(0); p8(255);   // color1 RGBA — Orange
  p24(1000); p8(0x15);                 // measure (1000g), unit (grams)
  p16(195); p16(215);                  // nozzle 195–215°C
  p8(60); p8(6); p8(55); p8(65);      // dryTemp, dryTime, bedMin, bedMax
  p32(750000000);                      // timestamp
  p8(200); p8(200); p8(200); p8(0);   // color2 + pad
  p8(0); p8(0); p8(0); p8(0);         // color3 + pad
  p16(125); p16(0);                    // tdRaw (12.5), pad
  Buffer.from('NFC SDK integration').copy(buf, o, 0, 19);
  o += 28;
  p24(850); p8(0);                     // measureAvailable (850g), pad

  return buf;
}

function main() {
  // Simulate data received from any NFC SDK
  const uid     = Buffer.from('04DEADBEEF1234', 'hex');  // 7-byte UID from NFC SDK
  const payload = makeDemoPayload();                      // 80 bytes (no signature in this demo)

  console.log('Simulating data from an NFC SDK read...');
  console.log(`  UID:          ${uid.toString('hex').toUpperCase()}`);
  console.log(`  Payload size: ${payload.length} bytes`);
  console.log();

  const tag = TigerTag.fromPages(payload, uid);
  console.log(tag.pretty());
}

main();
