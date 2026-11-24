import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BARS } from '../data/bars'
import { ITEMS } from '../data/items'
import { fmtBtlOz, summarize, type SummaryRow } from '../domain/summary'
import { exportMonthly } from '../export/xlsx'
import { repo } from '../storage/repo'
import { IconDownload, Wave } from '../components/Glyphs'

const BAR_ITEMS = ITEMS.filter((i) => i.form === 'bar')

function localMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const isValidMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

function Qty({ oz, sizeOz, testId }: { oz: number; sizeOz: number; testId?: string }) {
  return (
    <td className={`num${oz < 0 ? ' negative' : ''}`} data-testid={testId}>
      <span>{fmtBtlOz(oz, sizeOz)}</span>
      <small>{oz} oz</small>
    </td>
  )
}

function ItemRows({ r }: { r: SummaryRow }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr data-testid={`sum-${r.code}`}>
        <th scope="row" className="m-item">
          <button
            type="button"
            className="m-toggle"
            aria-expanded={open}
            aria-controls={`daily-${r.code}`}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
            <span className="m-name">{r.name}</span>
          </button>
        </th>
        <td className="num" data-testid="days">
          {r.days}
        </td>
        <Qty oz={r.totalIn} sizeOz={r.sizeOz} testId="in" />
        <Qty oz={r.totalOut} sizeOz={r.sizeOz} testId="out" />
        <Qty oz={r.totalSale} sizeOz={r.sizeOz} testId="sale" />
        <Qty oz={r.avgDailySale} sizeOz={r.sizeOz} testId="avg" />
        <Qty oz={r.lastClosed} sizeOz={r.lastSizeOz} testId="closed" />
      </tr>
      {open && (
        <tr className="m-daily-row">
          <td colSpan={7}>
            <table className="m-daily" id={`daily-${r.code}`} data-testid={`daily-${r.code}`}>
              <thead>
                <tr>
                  <th scope="col">วันที่</th>
                  <th scope="col">ขาย</th>
                  <th scope="col">คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                {r.dailyRows.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date}</td>
                    <Qty oz={d.sale} sizeOz={r.sizeOz} />
                    <Qty oz={d.closed} sizeOz={d.sizeOz} />
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

export default function Monthly() {
  const [barId, setBarId] = useState(BARS[0].id)
  const [month, setMonth] = useState(localMonth)

  const bar = BARS.find((b) => b.id === barId) ?? BARS[0]
  const records = useMemo(() => repo.listReports(barId, month), [barId, month])
  const rows = useMemo(() => summarize(records, BAR_ITEMS), [records])
  const recordedDays = new Set(records.map((r) => r.date)).size
  const draftDays = new Set(records.filter((r) => r.status === 'draft').map((r) => r.date)).size

  let lastCat = ''
  return (
    <main className="page page-monthly" data-testid="monthly">
      <p>
        <Link className="btn btn-plain m-back" to="/">
          ← หน้าแรก
        </Link>
      </p>
      <header className="m-head">
        <h1>สรุปรายเดือน</h1>
        <Wave />
      </header>

      <div className="m-controls">
        <label className="field">
          <span>บาร์</span>
          <select value={barId} onChange={(e) => setBarId(e.target.value)}>
            {BARS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>เดือน</span>
          <input
            type="month"
            value={month}
            onChange={(e) => isValidMonth(e.target.value) && setMonth(e.target.value)}
          />
        </label>
      </div>

      <button
        type="button"
        className="btn-primary m-export"
        disabled={rows.length === 0}
        onClick={() => exportMonthly(bar.name, month, rows)}
      >
        <IconDownload />
        Export Excel
      </button>

      {rows.length === 0 ? (
        <p className="notice notice-empty">ยังไม่มีข้อมูลเดือนนี้</p>
      ) : (
        <>
          <div className="m-notes">
            <span>บันทึกข้อมูล {recordedDays} วัน</span>
            {draftDays > 0 && <span className="badge badge-draft">{draftDays} วันยังเป็นร่าง</span>}
          </div>
          <div className="m-scroll" role="region" aria-label="ตารางสรุป" tabIndex={0}>
            <table className="m-table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">วัน</th>
                  <th scope="col">รับเข้า</th>
                  <th scope="col">โอนออก</th>
                  <th scope="col">ขาย</th>
                  <th scope="col">ขายเฉลี่ย/วัน</th>
                  <th scope="col">คงเหลือล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const showCat = r.category !== lastCat
                  lastCat = r.category
                  return (
                    <Fragment key={`${barId}:${month}:${r.code}`}>
                      {showCat && (
                        <tr className="m-cat">
                          <th colSpan={7} scope="rowgroup">
                            {r.category}
                          </th>
                        </tr>
                      )}
                      <ItemRows r={r} />
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}
