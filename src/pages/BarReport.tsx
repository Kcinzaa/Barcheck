import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import CategorySection from '../components/CategorySection'
import ItemCard, { type RowPatch } from '../components/ItemCard'
import { BARS, type Bar } from '../data/bars'
import { ITEMS } from '../data/items'
import { isTouched } from '../domain/calc'
import { carryOpen } from '../domain/carry'
import { emptyRow, sanitizeRow } from '../domain/row'
import type { BarReportRow, Item } from '../domain/types'
import { SAVE_ERROR } from '../hooks/useAutosave'
import { repo } from '../storage/repo'
import { IconCheck, Wave } from '../components/Glyphs'

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
    const stored = new Set<string>()
    for (const r of rec?.rows ?? []) {
      if (BAR_CODES.has(r.itemCode)) {
        rows[r.itemCode] = sanitizeRow(r)
        stored.add(r.itemCode)
      } else unknown.push(r) // item no longer in the seed: not shown, but kept on write
    }
    // Prefill Open from the latest earlier Closed. Display state only: such rows stay
    // untouched (isTouched ignores Open while openFrom is set), so nothing is written.
    const prev = repo.latestTouchedBefore(bar.id, date)
    for (const item of BAR_ITEMS) {
      const src = Object.prototype.hasOwnProperty.call(prev, item.code) ? prev[item.code] : undefined
      if (!src || stored.has(item.code)) continue
      rows[item.code] = { ...emptyRow(item.code), ...carryOpen(src.row, item.sizeOz ?? 0), openFrom: src.date }
    }
    return { rows, reportBy: typeof rec?.reportBy === 'string' ? rec.reportBy : '', unknown }
  })
  const [rows, setRows] = useState<Rows>(initial.rows)
  const [reportBy, setReportBy] = useState(initial.reportBy)
  const [query, setQuery] = useState('')
  const [justSaved, setJustSaved] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  const latest = useRef({ rows, reportBy })
  latest.current = { rows, reportBy }
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const write = useCallback(
    (status: 'draft' | 'saved'): boolean => {
      const { rows: r, reportBy: by } = latest.current
      const touched = BAR_ITEMS.map((i) => r[i.code]).filter(isTouched)
      return repo.saveReport({ barId: bar.id, date, reportBy: by, status, rows: [...touched, ...initial.unknown] })
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
    const ok = write('draft')
    if (!ok) dirty.current = true // retry on the next edit, save or flush; no timer loop
    setSaveFailed(!ok)
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
    setSaveFailed(false)
    setRows((prev) => {
      const next = { ...prev[code], ...patch }
      if (next.openFrom === undefined) delete next.openFrom
      return { ...prev, [code]: next }
    })
  }, [])

  const onSave = () => {
    clearTimer()
    const ok = write('saved')
    dirty.current = !ok
    setJustSaved(ok)
    setSaveFailed(!ok)
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
        <Wave />
        <label className="field">
          <span>ผู้รายงาน</span>
          <input
            type="text"
            value={reportBy}
            onChange={(e) => {
              dirty.current = true
              setJustSaved(false)
              setSaveFailed(false)
              setReportBy(e.target.value)
            }}
          />
        </label>
      </header>

      <div
        className="report-sticky has-progress"
        data-testid="report-sticky"
        style={{ '--progress': `${(filled / BAR_ITEMS.length) * 100}%` } as CSSProperties}
      >
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
        {saveFailed ? (
          <span role="alert" className="report-saved report-save-error">
            {SAVE_ERROR}
          </span>
        ) : (
          <span role="status" className="report-saved">
            {justSaved ? 'บันทึกแล้ว ✓' : ''}
          </span>
        )}
        <button type="button" className="btn-primary btn-save" onClick={onSave}>
          <IconCheck />
          บันทึก
        </button>
      </div>
    </main>
  )
}
