import { useCallback, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import CategorySection from '../components/CategorySection'
import QtyInput from '../components/QtyInput'
import { BARS, type Bar } from '../data/bars'
import { ITEMS } from '../data/items'
import type { Item } from '../domain/types'
import { useAutosave } from '../hooks/useAutosave'
import { isValidDate } from '../lib/dateParam'
import { repo } from '../storage/repo'

const REQ_ITEMS = ITEMS.filter((i) => i.form === 'requisition')
const REQ_CODES = new Set(REQ_ITEMS.map((i) => i.code))
const GROUPS: { category: string; items: Item[] }[] = []
for (const item of REQ_ITEMS) {
  const g = GROUPS.find((x) => x.category === item.category)
  if (g) g.items.push(item)
  else GROUPS.push({ category: item.category, items: [item] })
}

type Qtys = Record<string, number>
type Row = { itemCode: string; qty: number }

const clean = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0)

function NotFound({ message }: { message: string }) {
  return (
    <main className="page" data-testid="requisition">
      <p className="notice">{message}</p>
      <Link className="btn btn-plain" to="/">
        ← หน้าหลัก
      </Link>
    </main>
  )
}

export default function Requisition() {
  const { barId, date } = useParams()
  const bar = BARS.find((b) => b.id === barId)
  if (!bar) return <NotFound message={`ไม่พบบาร์ "${barId ?? ''}"`} />
  if (!isValidDate(date)) return <NotFound message={`วันที่ไม่ถูกต้อง: "${date ?? ''}" (ต้องเป็น YYYY-MM-DD)`} />
  return <ReqForm key={`${bar.id}/${date}`} bar={bar} date={date} />
}

function ReqForm({ bar, date }: { bar: Bar; date: string }) {
  const [initial] = useState(() => {
    const rec = repo.getReq(bar.id, date)
    const qtys: Qtys = {}
    const unknown: Row[] = []
    for (const r of rec?.rows ?? []) {
      if (REQ_CODES.has(r.itemCode)) qtys[r.itemCode] = clean(r.qty)
      else unknown.push(r) // item no longer in the seed: not shown, but kept on write
    }
    const s = (x: unknown) => (typeof x === 'string' ? x : '')
    return {
      qtys,
      unknown,
      requestedBy: s(rec?.requestedBy),
      approvedBy: s(rec?.approvedBy),
      issuedBy: s(rec?.issuedBy),
    }
  })
  const [qtys, setQtys] = useState<Qtys>(initial.qtys)
  const [people, setPeople] = useState({
    requestedBy: initial.requestedBy,
    approvedBy: initial.approvedBy,
    issuedBy: initial.issuedBy,
  })
  const [query, setQuery] = useState('')

  const latest = useRef({ qtys, people })
  latest.current = { qtys, people }

  const snapshot = useMemo(() => ({ qtys, people }), [qtys, people])

  const write = useCallback(
    (status: 'draft' | 'saved') => {
      const { qtys: q, people: p } = latest.current
      const rows: Row[] = REQ_ITEMS.filter((i) => (q[i.code] ?? 0) > 0).map((i) => ({
        itemCode: i.code,
        qty: q[i.code],
      }))
      repo.saveReq({ barId: bar.id, date, ...p, status, rows: [...rows, ...initial.unknown] })
    },
    [bar.id, date, initial.unknown],
  )

  const { markDirty, saveNow, justSaved } = useAutosave(write, snapshot)

  const setQty = useCallback(
    (code: string, n: number) => {
      markDirty()
      setQtys((prev) => ({ ...prev, [code]: clean(n) }))
    },
    [markDirty],
  )

  const setPerson = (key: keyof typeof people) => (e: React.ChangeEvent<HTMLInputElement>) => {
    markDirty()
    setPeople((p) => ({ ...p, [key]: e.target.value }))
  }

  const requested = useMemo(() => REQ_ITEMS.filter((i) => (qtys[i.code] ?? 0) > 0).length, [qtys])

  const q = query.trim().toLowerCase()
  const visible = q
    ? GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.name.toLowerCase().includes(q) || i.code.includes(q)),
      })).filter((g) => g.items.length > 0)
    : GROUPS

  return (
    <main className="page page-report page-req" data-testid="requisition">
      <nav className="report-nav">
        <Link className="btn btn-plain" to="/">
          ← หน้าหลัก
        </Link>
        <Link className="btn btn-plain" to={`/bar/${bar.id}/${date}/report`}>
          Bar Report →
        </Link>
      </nav>

      <header className="report-head">
        <h1>ใบเบิกสินค้า · {bar.name}</h1>
        <time dateTime={date}>{date}</time>
        <div className="req-people">
          <label className="field">
            <span>ผู้ขอเบิก</span>
            <input type="text" value={people.requestedBy} onChange={setPerson('requestedBy')} />
          </label>
          <label className="field">
            <span>ผู้อนุมัติ</span>
            <input type="text" value={people.approvedBy} onChange={setPerson('approvedBy')} />
          </label>
          <label className="field">
            <span>ผู้จ่าย</span>
            <input type="text" value={people.issuedBy} onChange={setPerson('issuedBy')} />
          </label>
        </div>
      </header>

      <div className="report-sticky">
        <input
          type="search"
          aria-label="ค้นหาสินค้า"
          placeholder="ค้นหาสินค้า…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="report-counter" data-testid="counter">
          รายการที่ขอ {requested}
        </span>
      </div>

      {visible.map((g) => (
        <CategorySection key={g.category} title={g.category} count={g.items.length} forceOpen={q !== ''}>
          {g.items.map((item) => (
            <div key={item.code} className="req-row" data-testid={`req-${item.code}`}>
              <div className="req-info">
                <span className="req-code">{item.code}</span>
                <span className="req-name">{item.name}</span>
              </div>
              <QtyInput
                label={`${item.name} (${item.code})`}
                unit={item.unit}
                value={qtys[item.code] ?? 0}
                onChange={(n) => setQty(item.code, n)}
              />
            </div>
          ))}
        </CategorySection>
      ))}
      {visible.length === 0 && <p className="notice">ไม่พบสินค้า "{query}"</p>}

      <div className="report-footer">
        <span role="status" className="report-saved">
          {justSaved ? 'บันทึกแล้ว ✓' : ''}
        </span>
        <button type="button" className="btn-primary" onClick={saveNow}>
          บันทึก
        </button>
      </div>
    </main>
  )
}
