import { isTouched } from '../domain/calc'
import { sanitizeRow } from '../domain/row'
import type { BarReportRow } from '../domain/types'
import { isValidDate } from '../lib/dateParam'

export interface ReportRecord {
  barId: string
  date: string
  reportBy: string
  status: 'draft' | 'saved'
  rows: BarReportRow[]
}

export interface ReqRecord {
  barId: string
  date: string
  requestedBy: string
  approvedBy: string
  issuedBy: string
  status: 'draft' | 'saved'
  rows: { itemCode: string; qty: number }[]
}

type FormStatus = 'none' | 'draft' | 'saved'

export interface Repo {
  getReport(barId: string, date: string): ReportRecord | null
  saveReport(r: ReportRecord): void
  getReq(barId: string, date: string): ReqRecord | null
  saveReq(r: ReqRecord): void
  listReports(barId: string, month: string): ReportRecord[]
  /** Per itemCode, the latest touched (sanitized) row from a report dated strictly before `date`. */
  latestTouchedBefore(barId: string, date: string): Record<string, { date: string; row: BarReportRow }>
  statusFor(barId: string, date: string): { report: FormStatus; req: FormStatus }
}

const reportPrefix = (barId: string) => `barcheck:report:${barId}:`
const reportKey = (barId: string, date: string) => reportPrefix(barId) + date
const reqKey = (barId: string, date: string) => `barcheck:req:${barId}:${date}`

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

const isStatus = (s: unknown) => s === 'draft' || s === 'saved'

function isReport(x: unknown, barId: string, date?: string): x is ReportRecord {
  if (!isObj(x)) return false
  return (
    x.barId === barId &&
    typeof x.date === 'string' &&
    (date === undefined || x.date === date) &&
    isStatus(x.status) &&
    Array.isArray(x.rows) &&
    x.rows.every((r) => isObj(r) && typeof r.itemCode === 'string')
  )
}

function isReq(x: unknown, barId: string, date: string): x is ReqRecord {
  if (!isObj(x)) return false
  return (
    x.barId === barId &&
    x.date === date &&
    isStatus(x.status) &&
    Array.isArray(x.rows) &&
    x.rows.every((r) => isObj(r) && typeof r.itemCode === 'string' && typeof r.qty === 'number')
  )
}

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch {
    return null
  }
}

function readReport(barId: string, date: string): ReportRecord | null {
  const v = read(reportKey(barId, date))
  return isReport(v, barId, date) ? v : null
}

function readReq(barId: string, date: string): ReqRecord | null {
  const v = read(reqKey(barId, date))
  return isReq(v, barId, date) ? v : null
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable or full: saving is best-effort
  }
}

export const repo: Repo = {
  getReport: readReport,
  saveReport: (r) => write(reportKey(r.barId, r.date), r),
  getReq: readReq,
  saveReq: (r) => write(reqKey(r.barId, r.date), r),

  listReports(barId, month) {
    const prefix = reportPrefix(barId)
    const datePrefix = `${month}-`
    const out: ReportRecord[] = []
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key || !key.startsWith(prefix)) continue
        if (!key.slice(prefix.length).startsWith(datePrefix)) continue
        const keyDate = key.slice(prefix.length)
        const rec = read(key)
        if (isReport(rec, barId, keyDate)) out.push(rec)
      }
    } catch {
      return []
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  },

  latestTouchedBefore(barId, date) {
    const prefix = reportPrefix(barId)
    const out = new Map<string, { date: string; row: BarReportRow }>()
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key || !key.startsWith(prefix)) continue
        const keyDate = key.slice(prefix.length)
        // YYYY-MM-DD strings compare chronologically
        if (!isValidDate(keyDate) || keyDate >= date) continue
        const rec = read(key)
        if (!isReport(rec, barId, keyDate)) continue
        for (const raw of rec.rows) {
          const row = sanitizeRow(raw)
          if (!isTouched(row)) continue
          const prev = out.get(row.itemCode)
          if (!prev || prev.date <= keyDate) out.set(row.itemCode, { date: keyDate, row })
        }
      }
    } catch {
      return {}
    }
    return Object.fromEntries(out)
  },

  statusFor(barId, date) {
    return {
      report: readReport(barId, date)?.status ?? 'none',
      req: readReq(barId, date)?.status ?? 'none',
    }
  },
}
