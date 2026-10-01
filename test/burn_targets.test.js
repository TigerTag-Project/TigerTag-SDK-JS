'use strict';

const { selectBurnTargets } = require('../tools/burn_targets');

describe('playground burn:write reader filter', () => {
  const readers = new Map([
    ['ACS ACR122U PICC Interface', { id: 'ACS ACR122U PICC Interface', hasCard: true }],
    ['ACS ACR122U PICC Interface 01', { id: 'ACS ACR122U PICC Interface 01', hasCard: true }],
    ['Empty reader', { id: 'Empty reader', hasCard: false }],
  ]);
  const names = (pairs) => pairs.map(([n]) => n);

  test('no filter targets every reader holding a card (backward compatible)', () => {
    expect(names(selectBurnTargets(readers))).toEqual([
      'ACS ACR122U PICC Interface', 'ACS ACR122U PICC Interface 01',
    ]);
    expect(names(selectBurnTargets(readers, ''))).toHaveLength(2);
  });

  test('a reader filter targets only that reader', () => {
    expect(names(selectBurnTargets(readers, 'ACS ACR122U PICC Interface 01')))
      .toEqual(['ACS ACR122U PICC Interface 01']);
  });

  test('an array filter targets each listed reader', () => {
    expect(names(selectBurnTargets(readers, ['ACS ACR122U PICC Interface', 'Empty reader'])))
      .toEqual(['ACS ACR122U PICC Interface']);
  });

  test('a filter never targets a reader without a card, or an unknown reader', () => {
    expect(selectBurnTargets(readers, 'Empty reader')).toEqual([]);
    expect(selectBurnTargets(readers, 'nope')).toEqual([]);
  });
});
