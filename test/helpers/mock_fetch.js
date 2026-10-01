'use strict';

// Mocked TigerTag API / GitHub mirror for reference-table tests.
// makeFetch({ lastUpdate, tables, failApi, failAll }) → jest-compatible fetch(url)
const fs   = require('fs');
const path = require('path');

const BUNDLED = path.join(__dirname, '..', '..', 'database');
const bundledLastUpdate = () => JSON.parse(fs.readFileSync(path.join(BUNDLED, 'last_update.json'), 'utf8'));

const ENDPOINT_FILE = {
  'version/get/all': 'id_version.json', 'type/get/all': 'id_type.json', 'brand/get/all': 'id_brand.json',
  'diameter/filament/get/all': 'id_diameter.json', 'material/get/all': 'id_material.json',
  'aspect/get/all': 'id_aspect.json', 'measure_unit/get/all': 'id_measure_unit.json',
};

function makeFetch({ lastUpdate = bundledLastUpdate(), tables = {}, failApi = false, failAll = false } = {}) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (failAll || (failApi && url.includes('api.tigertag.io'))) throw new Error('getaddrinfo ENOTFOUND');
    const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body), json: async () => body });
    if (url.endsWith('/all/last_update') || url.endsWith('/last_update.json')) return ok(lastUpdate);
    let file = null;
    for (const [ep, fn] of Object.entries(ENDPOINT_FILE)) if (url.endsWith('/' + ep)) file = fn;
    if (!file) file = path.basename(url);
    if (tables[file]) return ok(tables[file]);
    return ok(JSON.parse(fs.readFileSync(path.join(BUNDLED, file), 'utf8')));
  };
  fetch.calls = calls;
  return fetch;
}

module.exports = { makeFetch, bundledLastUpdate };
