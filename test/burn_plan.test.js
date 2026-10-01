'use strict';

const { buildBurnPlan, SIG_FIRST_PAGE } = require('../tools/burn_plan');

const user = () => Buffer.from(Array.from({ length: 80 }, (_, i) => (i + 1) & 0xFF));

describe('playground burn page plan', () => {
  test('144-byte payload without signature → 36 pages, 0x04–0x27, signature pages zeroed', () => {
    const plan = buildBurnPlan(Buffer.concat([user(), Buffer.alloc(64)]));
    expect(plan.signatureDropped).toBe(false);
    expect(plan.pages).toHaveLength(36);
    expect(plan.pages[0].page).toBe(0x04);
    expect(plan.pages[35].page).toBe(0x27);
    expect([...plan.pages[0].data]).toEqual([1, 2, 3, 4]);
    expect([...plan.pages[19].data]).toEqual([77, 78, 79, 80]);   // page 0x17
    for (const p of plan.pages.filter((x) => x.page >= SIG_FIRST_PAGE)) {
      expect([...p.data]).toEqual([0, 0, 0, 0]);
    }
  });

  test('80-byte payload is padded: signature pages written as 00', () => {
    const plan = buildBurnPlan(user());
    expect(plan.signatureDropped).toBe(false);
    expect(plan.pages).toHaveLength(36);
    expect(plan.pages.filter((p) => p.page >= SIG_FIRST_PAGE).every((p) => p.data.equals(Buffer.alloc(4)))).toBe(true);
  });

  test('144-byte payload WITH a signature → the signature is never written (00 on 0x18–0x27)', () => {
    const sig = Buffer.from(Array.from({ length: 64 }, (_, i) => 0xA0 + (i % 16)));
    const plan = buildBurnPlan(Buffer.concat([user(), sig]));
    expect(plan.signatureDropped).toBe(true);
    expect(plan.pages).toHaveLength(36);
    expect(Buffer.concat(plan.pages.slice(0, 20).map((p) => p.data)).equals(user())).toBe(true);
    expect(Buffer.concat(plan.pages.slice(20).map((p) => p.data)).equals(Buffer.alloc(64))).toBe(true);
  });

  test('never plans pages 0–3 or 0x28+', () => {
    for (const payload of [user(), Buffer.concat([user(), Buffer.alloc(64, 0xFF)])]) {
      const plan = buildBurnPlan(payload);
      expect(plan.pages.every((p) => p.page >= 0x04 && p.page <= 0x27)).toBe(true);
    }
  });

  test('rejects any other length', () => {
    for (const n of [0, 4, 79, 81, 143, 145, 180]) {
      expect(() => buildBurnPlan(Buffer.alloc(n))).toThrow(RangeError);
    }
    expect(() => buildBurnPlan(null)).toThrow(RangeError);
  });
});
