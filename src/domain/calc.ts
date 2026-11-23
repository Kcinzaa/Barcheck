import type { BarReportRow } from './types';
import { toOz } from './units';

const round1 = (n: number): number => {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? 0 : r;
};

export function calcRow(
  row: BarReportRow,
  sizeOz: number,
): { total1: number; total2: number; closed: number; variance: number | null; negative: boolean } {
  const open = toOz(row.openBtl, row.openOz, sizeOz);
  const total1 = round1(open + row.dailyStore + row.transferIn);
  const total2 = round1(total1 - row.transferOut);
  const closed = round1(total2 - row.sale);
  const hasCounted = row.countedBtl !== undefined || row.countedOz !== undefined;
  const variance = hasCounted
    ? round1(toOz(row.countedBtl ?? 0, row.countedOz ?? 0, sizeOz) - closed)
    : null;
  return { total1, total2, closed, variance, negative: closed < 0 };
}

export function isTouched(row: BarReportRow): boolean {
  return (
    row.openBtl !== 0 ||
    row.openOz !== 0 ||
    row.dailyStore !== 0 ||
    row.transferIn !== 0 ||
    row.transferOut !== 0 ||
    row.sale !== 0 ||
    row.countedBtl !== undefined ||
    row.countedOz !== undefined ||
    row.remark.trim() !== ''
  );
}
