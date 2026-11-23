import type { BarReportRow } from '../domain/types'

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
  statusFor(barId: string, date: string): { report: FormStatus; req: FormStatus }
}

const reportPrefix = (barId: string) => `barcheck:report:${barId}:`
const reportKey = (barId: string, date: string) => reportPrefix(barId) + date
const reqKey = (barId: string, date: string) => `barcheck:req:${barId}:${date}`

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable or full: saving is best-effort
  }
}

export const repo: Repo = {
  getReport: (barId, date) => read<ReportRecord>(reportKey(barId, date)),
  saveReport: (r) => write(reportKey(r.barId, r.date), r),
  getReq: (barId, date) => read<ReqRecord>(reqKey(barId, date)),
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
        const rec = read<ReportRecord>(key)
        if (rec) out.push(rec)
      }
    } catch {
      return []
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  },

  statusFor(barId, date) {
    return {
      report: read<ReportRecord>(reportKey(barId, date))?.status ?? 'none',
      req: read<ReqRecord>(reqKey(barId, date))?.status ?? 'none',
    }
  },
}
