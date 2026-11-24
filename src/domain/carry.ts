import { calcRow } from './calc';
import type { BarReportRow } from './types';
import { fromOz, toOz } from './units';

/**
 * Opening stock carried from an earlier day's row: the counted value when one was
 * entered, else the computed Closed. Negative stock is carried as 0.
 */
export function carryOpen(row: BarReportRow, sizeOz: number): { openBtl: number; openOz: number } {
  const counted = row.countedBtl !== undefined || row.countedOz !== undefined;
  const value = counted ? toOz(row.countedBtl ?? 0, row.countedOz ?? 0, sizeOz) : calcRow(row, sizeOz).closed;
  const { bottles, oz } = fromOz(Math.max(0, value), sizeOz);
  return { openBtl: bottles, openOz: oz };
}
