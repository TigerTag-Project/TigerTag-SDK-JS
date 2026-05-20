#!/usr/bin/env node
'use strict';

const path = require('path');
const { syncDatabases } = require('../src/index');

const dbPath = path.join(__dirname, '..', 'database');

syncDatabases(dbPath, { force: false, verbose: true })
  .then((updated) => {
    if (updated.length > 0) {
      console.log(`\n✓ Updated: ${updated.join(', ')}`);
    } else {
      console.log('\n✓ All databases are up to date.');
    }
  })
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
