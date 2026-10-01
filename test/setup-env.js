'use strict';

// Every test runs offline and with a throw-away data dir: no network call and
// nothing written to the user's real cache folder unless a test opts in
// explicitly (offline: false + a mocked fetch + its own temporary folder).
const fs   = require('fs');
const os   = require('os');
const path = require('path');

process.env.TIGERTAG_OFFLINE  = '1';
process.env.TIGERTAG_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tigertag-test-data-'));
