'use strict';

/**
 * Select the readers a `burn:write` request targets.
 *
 * Without a filter every reader holding a card is targeted (historical
 * behaviour). With a filter only the named reader(s) are targeted — the
 * playground uses this for twin tags, where each reader gets its own payload.
 *
 * @param {Map<string, {hasCard: boolean}>} readers - readerName → reader state.
 * @param {string|string[]|null|undefined} [filter] - Reader id(s) / name(s) to keep.
 * @returns {Array<[string, object]>} [readerName, state] pairs, in map order.
 */
function selectBurnTargets(readers, filter) {
  const wanted = filter == null || filter === ''
    ? null
    : new Set(Array.isArray(filter) ? filter : [filter]);
  return [...readers.entries()].filter(([name, info]) =>
    info && info.hasCard && (!wanted || wanted.has(name) || wanted.has(info.id)));
}

module.exports = { selectBurnTargets };
