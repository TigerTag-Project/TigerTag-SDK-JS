'use strict';

const FIRST_PAGE     = 0x04;   // first user page
const SIG_FIRST_PAGE = 0x18;   // signature R starts here
const LAST_PAGE      = 0x27;   // signature S ends here
const USER_LEN       = 80;     // pages 0x04–0x17
const FULL_LEN       = 144;    // pages 0x04–0x27

/**
 * Build the page-by-page write plan for a burn.
 *
 * The plan always covers pages 0x04–0x27 (36 pages):
 * - pages 0x04–0x17 get the payload's first 80 bytes (the tag data);
 * - pages 0x18–0x27 (the ECDSA signature) are ALWAYS written as 00 00 00 00.
 * A playground never writes a signature: only a certified manufacturer can
 * issue one, and a signature copied from another chip is invalid anyway since
 * it covers that chip's UID. Clearing the pages means a burn never leaves a
 * stale signature behind. Pages 0–3 (UID, lock, capability container) and
 * 0x28+ (configuration) are never part of the plan.
 *
 * @param {Buffer|Uint8Array} payload - 80 or 144 bytes starting at page 0x04.
 * @returns {{ signatureDropped: boolean, pages: Array<{ page: number, data: Buffer }> }}
 *   signatureDropped is true when the input carried a non-zero signature that was not written.
 * @throws {RangeError} When the payload is not 80 or 144 bytes long.
 */
function buildBurnPlan(payload) {
  const buf = Buffer.from(payload || []);
  if (buf.length !== USER_LEN && buf.length !== FULL_LEN) {
    throw new RangeError(`burn payload must be ${USER_LEN} or ${FULL_LEN} bytes, got ${buf.length}`);
  }
  const signatureDropped = buf.subarray(USER_LEN).some((b) => b !== 0);
  const image = Buffer.alloc(FULL_LEN);                 // signature area stays 00
  buf.copy(image, 0, 0, USER_LEN);
  const pages = [];
  for (let page = FIRST_PAGE; page <= LAST_PAGE; page++) {
    const o = (page - FIRST_PAGE) * 4;
    pages.push({ page, data: Buffer.from(image.subarray(o, o + 4)) });
  }
  return { signatureDropped, pages };
}

module.exports = { buildBurnPlan, FIRST_PAGE, SIG_FIRST_PAGE, LAST_PAGE };
