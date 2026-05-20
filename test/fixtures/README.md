# TigerTag Test Fixtures

Pre-built binary `.bin` files for SDK testing. No NFC hardware required.

## Fixtures

| File | Size | Type | Description |
|------|------|------|-------------|
| `tigertag_pla_rosa3d.bin` | 80B | TigerTag | PLA Rosa3D Red, full stock (1000g) |
| `tigertag_petg_bambu_silk.bin` | 80B | TigerTag | PETG Silk Bambu Lab, Blue |
| `tigertag_pla_bicolor.bin` | 80B | TigerTag | PLA Bicolor Polymaker, Orange+Black |
| `tigertag_resin_generic.bin` | 80B | TigerTag | Castable Resin Generic, 500ml |
| `tigertag_low_stock.bin` | 80B | TigerTag | PLA eSun Green, 150g remaining (15%) |
| `tigertag_plus_bambu.bin` | 80B | TigerTag+ | PETG Bambu Lab, cloud product ID |
| `tigertag_init.bin` | 80B | TigerTag Init | Blank/uninitialized chip |
| `tigertag_full_dump.bin` | 180B | TigerTag | Full chip dump, UID auto-extractable |

## Loading fixtures

```js
const { TigerTag } = require('tigertag');

// Load any fixture — works without NFC hardware
const tag = TigerTag.fromFile('test/fixtures/tigertag_pla_rosa3d.bin');
console.log(tag.pretty());
```

## Formats

**80 bytes** — user data only (pages 0x04–0x17). No signature. Requires explicit UID.

**144 bytes** — user data + ECDSA signature (pages 0x04–0x27). Requires explicit UID.

**180 bytes** — full chip dump (pages 0–44). UID auto-extracted from pages 0–1.

## Regenerating

```bash
node scripts/generate_fixtures.js
```
