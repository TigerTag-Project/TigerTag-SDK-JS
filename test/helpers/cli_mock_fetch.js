'use strict';
// Preloaded with `node -r` by the CLI test: replaces global fetch by the mock.
// TIGERTAG_MOCK_BRANDS_TS bumps the brands timestamp so exactly one table changes.
const { makeFetch, bundledLastUpdate } = require('./mock_fetch');
const lu = bundledLastUpdate();
if (process.env.TIGERTAG_MOCK_BRANDS_TS) lu.brands = Number(process.env.TIGERTAG_MOCK_BRANDS_TS);
globalThis.fetch = makeFetch({ lastUpdate: lu, tables: { 'id_brand.json': [{ id: 1, name: 'Mock brand' }] } });
