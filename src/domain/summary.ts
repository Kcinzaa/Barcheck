import { calcRow, isTouched } from './calc'
import { fromOz } from './units'
import type { Item } from './types'
import type { ReportRecord } from '../storage/repo'

export interface SummaryRow {
  code: string
  name: string
  category: string
  sizeOz: number
  /** number of days with a touched row */
  days: number
  /** oz: Σ (dailyStore + transferIn) */
  totalIn: number
  /** oz: Σ transferOut */
  totalOut: number
  /** oz: Σ sale */
  totalSale: number
  /** oz per recorded day: totalSale / distinct dates among all records passed in, rounded to 0.1 */
  avgDailySale: number
  /** oz: closed balance on the latest date with a touched row */
  lastClosed: number
  dailyRows: { date: string; closed: number; sale: number }[]
}

const round1 = (n: number): number => {
  const r = Math.round(n * 10 + Number.EPSILON * Math.sign(n)) / 10
  return r === 0 ? 0 : r
}

/** Per-item month totals (oz) over touched rows; orphan codes and idle items are dropped. */
export function summarize(records: ReportRecord[], items: Item[]): SummaryRow[] {
  const byCode = new Map(items.map((i) => [i.code, i]))
  const acc = new Map<string, SummaryRow>()

  const recordedDays = new Set(records.map((r) => r.date)).size
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date))
  for (const rec of sorted) {
    for (const row of rec.rows) {
      const item = byCode.get(row.itemCode)
      if (!item || !isTouched(row)) continue
      const sizeOz = item.sizeOz ?? 0
      let s = acc.get(item.code)
      if (!s) {
        s = {
          code: item.code,
          name: item.name,
          category: item.category,
          sizeOz,
          days: 0,
          totalIn: 0,
          totalOut: 0,
          totalSale: 0,
          avgDailySale: 0,
          lastClosed: 0,
          dailyRows: [],
        }
        acc.set(item.code, s)
      }
      const { closed } = calcRow(row, sizeOz)
      s.days += 1
      s.totalIn = round1(s.totalIn + row.dailyStore + row.transferIn)
      s.totalOut = round1(s.totalOut + row.transferOut)
      s.totalSale = round1(s.totalSale + row.sale)
      s.lastClosed = closed
      s.dailyRows.push({ date: rec.date, closed, sale: row.sale })
    }
  }

  for (const s of acc.values()) s.avgDailySale = recordedDays > 0 ? round1(s.totalSale / recordedDays) : 0

  // category order = first appearance in `items`, then item order within it
  const catRank = new Map<string, number>()
  items.forEach((i) => {
    if (!catRank.has(i.category)) catRank.set(i.category, catRank.size)
  })
  const out: SummaryRow[] = []
  for (const cat of catRank.keys()) {
    for (const i of items) {
      if (i.category !== cat) continue
      const s = acc.get(i.code)
      if (s) out.push(s)
    }
  }
  return out
}

/** Bottles + oz with the sign on both parts, so bottles * sizeOz + oz === totalOz. */
export function splitBtlOz(totalOz: number, sizeOz: number): { bottles: number; oz: number } {
  if (totalOz >= 0) return fromOz(totalOz, sizeOz)
  const { bottles, oz } = fromOz(-totalOz, sizeOz)
  return { bottles: bottles === 0 ? 0 : -bottles, oz: oz === 0 ? 0 : -oz }
}

/** "N ขวด M oz", negatives as "−N ขวด M oz". */
export function fmtBtlOz(totalOz: number, sizeOz: number): string {
  const { bottles, oz } = fromOz(Math.abs(totalOz), sizeOz)
  const text = `${bottles} ขวด ${oz} oz`
  return round1(totalOz) < 0 ? `−${text}` : text
}
