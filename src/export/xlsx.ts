// SheetJS is used ONLY to write workbooks; never parse files with it.
// It is loaded on demand so the ~400 kB library stays out of the main bundle.
import { splitBtlOz, type SummaryRow } from '../domain/summary'

type Cell = string | number

export const SUMMARY_HEADER: string[] = [
  'Code / รหัส',
  'Item / สินค้า',
  'Category / หมวด',
  'Size (oz) / ขนาด',
  'Days / วัน',
  'In (oz) / รับเข้า',
  'Out (oz) / โอนออก',
  'Sale (oz) / ขาย',
  'ขายเฉลี่ย/วัน (oz)',
  'Closed (oz) / คงเหลือล่าสุด',
  'Closed bottles / ขวด',
  'Closed +oz / oz',
]

export const DAILY_HEADER: string[] = [
  'Date / วันที่',
  'Code / รหัส',
  'Item / สินค้า',
  'Sale (oz) / ขาย',
  'Closed (oz) / คงเหลือ',
]

/** Pure row-shaping for the two sheets; all quantities are numeric oz cells. */
export function toSheets(
  _barName: string,
  _month: string,
  rows: SummaryRow[],
): { summary: Cell[][]; daily: Cell[][] } {
  const summary: Cell[][] = [SUMMARY_HEADER]
  const daily: Cell[][] = [DAILY_HEADER]
  for (const r of rows) {
    const { bottles, oz } = splitBtlOz(r.lastClosed, r.lastSizeOz)
    summary.push([
      r.code,
      r.name,
      r.category,
      r.sizeOz,
      r.days,
      r.totalIn,
      r.totalOut,
      r.totalSale,
      r.avgDailySale,
      r.lastClosed,
      bottles,
      oz,
    ])
    for (const d of r.dailyRows) daily.push([d.date, r.code, r.name, d.sale, d.closed])
  }
  return { summary, daily }
}

/** barcheck-{bar}-{month}.xlsx with the bar name reduced to filename-safe characters. */
export function exportFileName(barName: string, month: string): string {
  const bar = barName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'bar'
  return `barcheck-${bar}-${month}.xlsx`
}

export function exportMonthly(barName: string, month: string, rows: SummaryRow[]): void {
  const { summary, daily } = toSheets(barName, month, rows)
  void import('xlsx')
    .then((XLSX) => {
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary')
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(daily), 'Daily')
      XLSX.writeFile(wb, exportFileName(barName, month))
    })
    .catch(() => {
      alert('Export ไม่สำเร็จ ลองใหม่อีกครั้ง')
    })
}
