import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import CategorySection from '../components/CategorySection'
import ItemCard, { type RowPatch } from '../components/ItemCard'
import { BARS, type Bar } from '../data/bars'
import { ITEMS } from '../data/items'
import { isTouched } from '../domain/calc'
import type { BarReportRow, Item } from '../domain/types'
import { repo } from '../storage/repo'

const BAR_ITEMS = ITEMS.filter((i) => i.form === 'bar')
const BAR_CODES = new Set(BAR_ITEMS.map((i) => i.code))
const GROUPS: { category: string; items: Item[] }[] = []
for (const item of BAR_ITEMS) {
  const g = GROUPS.find((x) => x.category === item.category)
  if (g) g.items.push(item)
  else GROUPS.push({ category: item.category, items: [item] })
}

const AUTOSAVE_MS = 300
const CONFIRM_MS = 2500

type Rows = Record<string, BarReportRow>

function isValidDate(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const optNum = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

const emptyRow = (itemCode: string): BarReportRow => ({
  itemCode,
  openBtl: 0,
  openOz: 0,
  dailyStore: 0,
  transferIn: 0,
  transferOut: 0,
  sale: 0,
  remark: '',
})

/** Stored rows are only shape-checked by the repo; coerce every field so nothing renders as NaN. */
function sanitize(r: BarReportRow): BarReportRow {
  const row: BarReportRow = {
    itemCode: r.itemCode,
    openBtl: num(r.openBtl),
    openOz: num(r.openOz),
    dailyStore: num(r.dailyStore),
    transferIn: num(r.transferIn),
    transferOut: num(r.transferOut),
    sale: num(r.sale),
    remark: typeof r.remark === 'string' ? r.remark : '',
  }
  const cb = optNum(r.countedBtl)
  const co = optNum(r.countedOz)
  if (cb !== undefined) row.countedBtl = cb
  if (co !== undefined) row.countedOz = co
  return row
}

function NotFound({ message }: { message: string }) {
  return (
    <main className="page" data-testid="bar-report">
      <p className="notice">{message}</p>
      <Link className="btn btn-plain" to="/">
        ← หน้าหลัก
      </Link>
    </main>
  )
}

export default function BarReport() {
  const { barId, date } = useParams()
  const bar = BARS.find((b) => b.id === barId)
  if (!bar) return <NotFound message={`ไม่พบบาร์ "${barId ?? ''}"`} />
  if (!isValidDate(date)) return <NotFound message={`วันที่ไม่ถูกต้อง: "${date ?? ''}" (ต้องเป็น YYYY-MM-DD)`} />
  return <ReportForm key={`${bar.id}/${date}`} bar={bar} date={date} />
}

function ReportForm({ bar, date }: { bar: Bar; date: string }) {
  const [initial] = useState(() => {
    const rec = repo.getReport(bar.id, date)
    const rows: Rows = {}
    for (const item of BAR_ITEMS) rows[item.code] = emptyRow(item.code)
    const unknown: BarReportRow[] = []
    for (const r of rec?.rows ?? []) {
      if (BAR_CODES.has(r.itemCode)) rows[r.itemCode] = sanitize(r)
      else unknown.push(r) // item no longer in the seed: not shown, but kept on write
    }
    return { rows, reportBy: typeof rec?.reportBy === 'string' ? rec.reportBy : '', unknown }
  })
  const [rows, setRows] = useState<Rows>(initial.rows)
  const [reportBy, setReportBy] = useState(initial.reportBy)
  const [query, setQuery] = useState('')
  const [justSaved, setJustSaved] = useState(false)

  const latest = useRef({ rows, reportBy })
  latest.current = { rows, reportBy }
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const write = useCallback(
    (status: 'draft' | 'saved') => {
      const { rows: r, reportBy: by } = latest.current
      const touched = BAR_ITEMS.map((i) => r[i.code]).filter(isTouched)
      repo.saveReport({ barId: bar.id, date, reportBy: by, status, rows: [...touched, ...initial.unknown] })
    },
    [bar.id, date, initial.unknown],
  )

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }

  /** Write a pending draft now, if the user edited anything since the last write. */
  const flush = useCallback(() => {
    clearTimer()
    if (!dirty.current) return
    dirty.current = false
    write('draft')
  }, [write])

  // Debounced draft autosave; only after a real edit, so opening the page never writes.
  useEffect(() => {
    if (!dirty.current) return
    clearTimer()
    timer.current = setTimeout(flush, AUTOSAVE_MS)
  }, [rows, reportBy, flush])

  // Leaving the page (route change, tab hidden/closed) must never lose typed data.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [flush])

  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => setJustSaved(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [justSaved])

  const onRowChange = useCallback((code: string, patch: RowPatch) => {
    dirty.current = true
    setJustSaved(false)
    setRows((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }))
  }, [])

  const onSave = () => {
    clearTimer()
    dirty.current = false
    write('saved')
    setJustSaved(true)
  }

  const filled = useMemo(() => BAR_ITEMS.filter((i) => isTouched(rows[i.code])).length, [rows])

  const q = query.trim().toLowerCase()
  const visible = q
    ? GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => i.name.toLowerCase().includes(q)) })).filter(
        (g) => g.items.length > 0,
      )
    : GROUPS

  return (
    <main className="page page-report" data-testid="bar-report">
      <nav className="report-nav">
        <Link className="btn btn-plain" to="/">
          ← หน้าหลัก
        </Link>
        <Link className="btn btn-plain" to={`/bar/${bar.id}/${date}/requisition`}>
          ใบเบิก →
        </Link>
      </nav>

      <header className="report-head" data-testid="report-head">
        <h1>Bar Report · {bar.name}</h1>
        <time dateTime={date}>{date}</time>
        <label className="field">
          <span>ผู้รายงาน</span>
          <input
            type="text"
            value={reportBy}
            onChange={(e) => {
              dirty.current = true
              setJustSaved(false)
              setReportBy(e.target.value)
            }}
          />
        </label>
      </header>

      <div className="report-sticky" data-testid="report-sticky">
        <input
          type="search"
          aria-label="ค้นหาสินค้า"
          placeholder="ค้นหาสินค้า…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="report-counter" data-testid="counter">
          กรอกแล้ว {filled}/{BAR_ITEMS.length}
        </span>
      </div>

      {visible.map((g) => (
        <CategorySection key={g.category} title={g.category} count={g.items.length} forceOpen={q !== ''}>
          {g.items.map((item) => (
            <ItemCard key={item.code} item={item} row={rows[item.code]} onChange={onRowChange} />
          ))}
        </CategorySection>
      ))}
      {visible.length === 0 && <p className="notice">ไม่พบสินค้า "{query}"</p>}

      <div className="report-footer">
        <span role="status" className="report-saved">
          {justSaved ? 'บันทึกแล้ว ✓' : ''}
        </span>
        <button type="button" className="btn-primary" onClick={onSave}>
          บันทึก
        </button>
      </div>
    </main>
  )
}
