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
  /** ISO time of the last local save; set by saveReport. */
  updatedAt?: string
}

export interface ReqRecord {
  barId: string
  date: string
  requestedBy: string
  approvedBy: string
  issuedBy: string
  status: 'draft' | 'saved'
  rows: { itemCode: string; qty: number }[]
  /** ISO time of the last local save; set by saveReq. */
  updatedAt?: string
}

export interface SavedEvent {
  form: 'report' | 'req'
  barId: string
  date: string
}

type FormStatus = 'none' | 'draft' | 'saved'

export interface Repo {
  getReport(barId: string, date: string): ReportRecord | null
  /** Returns true only if the value was actually written. */
  saveReport(r: ReportRecord): boolean
  getReq(barId: string, date: string): ReqRecord | null
  /** Returns true only if the value was actually written. */
  saveReq(r: ReqRecord): boolean
  listReports(barId: string, month: string): ReportRecord[]
  /** Per itemCode, the latest touched (sanitized) row from a report dated strictly before `date`. */
  latestTouchedBefore(barId: string, date: string): Record<string, { date: string; row: BarReportRow }>
  statusFor(barId: string, date: string): { report: FormStatus; req: FormStatus }
  /** Called synchronously after each successful local save (not for mergeRemote). Returns an unsubscribe. */
  onSaved(listener: (e: SavedEvent) => void): () => void
  /**
   * Apply a record pulled from the remote as-is (keeps its updatedAt). `pendingKeys` holds
   * "{form}:{barId}:{date}". Returns false if skipped (pending, malformed) or the write failed.
   */
  mergeRemote(form: 'report' | 'req', record: ReportRecord | ReqRecord, pendingKeys: Set<string>): boolean
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

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    // storage unavailable or full: the caller must tell the user
    return false
  }
}

const listeners = new Set<(e: SavedEvent) => void>()

function emit(e: SavedEvent) {
  for (const l of [...listeners]) {
    try {
      l(e)
    } catch {
      // a faulty listener must not affect the save or other listeners
    }
  }
}

export const repo: Repo = {
  getReport: readReport,
  saveReport(r) {
    if (!write(reportKey(r.barId, r.date), { ...r, updatedAt: new Date().toISOString() })) return false
    emit({ form: 'report', barId: r.barId, date: r.date })
    return true
  },
  getReq: readReq,
  saveReq(r) {
    if (!write(reqKey(r.barId, r.date), { ...r, updatedAt: new Date().toISOString() })) return false
    emit({ form: 'req', barId: r.barId, date: r.date })
    return true
  },

  onSaved(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  mergeRemote(form, record, pendingKeys) {
    if (!isObj(record) || typeof record.barId !== 'string' || typeof record.date !== 'string') return false
    const { barId, date } = record
    if (pendingKeys.has(`${form}:${barId}:${date}`)) return false
    if (form === 'report') {
      if (!isReport(record, barId, date) || !isValidDate(date)) return false
      return write(reportKey(barId, date), record)
    }
    if (!isReq(record, barId, date) || !isValidDate(date)) return false
    return write(reqKey(barId, date), record)
  },

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
