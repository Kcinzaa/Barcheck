import { describe, expect, it } from 'vitest';
import { BARS } from './bars';
import { ITEMS } from './items';

describe('seed data', () => {
  it('has 12 bars', () => {
    expect(BARS.length).toBe(12);
    expect(BARS.map((b) => b.id)).toContain('the-cove');
  });
  it('every item has code, name, category', () => {
    for (const i of ITEMS) {
      expect(i.code.length).toBeGreaterThan(0);
      expect(i.name.length).toBeGreaterThan(0);
      expect(i.category.length).toBeGreaterThan(0);
    }
  });
  it('codes unique within each form', () => {
    for (const form of ['bar', 'requisition'] as const) {
      const codes = ITEMS.filter((i) => i.form === form).map((i) => i.code);
      expect(new Set(codes).size).toBe(codes.length);
    }
  });
  it('has no duplicate normalised names within the bar form', () => {
    const names = ITEMS.filter((i) => i.form === 'bar').map((i) =>
      i.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    );
    const dups = names.filter((n, idx) => names.indexOf(n) !== idx);
    expect(dups).toEqual([]);
  });
  it('contains both forms', () => {
    expect(ITEMS.some((i) => i.form === 'bar')).toBe(true);
    expect(ITEMS.some((i) => i.form === 'requisition')).toBe(true);
  });
  it('bar items have a finite positive sizeOz', () => {
    for (const i of ITEMS.filter((x) => x.form === 'bar')) {
      expect(Number.isFinite(i.sizeOz)).toBe(true);
      expect(i.sizeOz as number).toBeGreaterThan(0);
    }
  });
  it('keeps PDF-observed sizes', () => {
    const size = (re: RegExp) => ITEMS.find((i) => i.form === 'bar' && re.test(i.name))?.sizeOz;
    expect(size(/^MARTINI BIANCO/)).toBe(33);
    expect(size(/^MONKEY 47/)).toBe(16);
    expect(ITEMS.find((i) => i.form === 'bar' && i.category === 'FROZEN' && i.name === 'MANGO')?.sizeOz).toBe(63);
    expect(size(/^SANGRIA/)).toBe(8);
    expect(size(/^BACARDI CARTA ORO/)).toBe(25);
  });
});
