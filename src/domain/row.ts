import { isValidDate } from '../lib/dateParam';
import type { BarReportRow } from './types';

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const optNum = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

export const emptyRow = (itemCode: string): BarReportRow => ({
  itemCode,
  openBtl: 0,
  openOz: 0,
  dailyStore: 0,
  transferIn: 0,
  transferOut: 0,
  sale: 0,
  remark: '',
});

/**
 * Stored rows are only shape-checked by the repo (itemCode is a string); coerce every
 * field so nothing renders or computes as NaN. A malformed optional field is dropped.
 */
export function sanitizeRow(r: BarReportRow): BarReportRow {
  const row: BarReportRow = {
    itemCode: r.itemCode,
    openBtl: num(r.openBtl),
    openOz: num(r.openOz),
    dailyStore: num(r.dailyStore),
    transferIn: num(r.transferIn),
    transferOut: num(r.transferOut),
    sale: num(r.sale),
    remark: typeof r.remark === 'string' ? r.remark : '',
  };
  const cb = optNum(r.countedBtl);
  const co = optNum(r.countedOz);
  if (cb !== undefined) row.countedBtl = cb;
  if (co !== undefined) row.countedOz = co;
  if (isValidDate(r.openFrom)) row.openFrom = r.openFrom;
  return row;
}
