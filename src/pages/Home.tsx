import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BARS } from '../data/bars'
import { repo } from '../storage/repo'
import { IconCalendar, IconReport, IconRequisition, Wave } from '../components/Glyphs'

const LOGO = `${import.meta.env.BASE_URL}logo.webp`

type FormStatus = 'none' | 'draft' | 'saved'

function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const LABEL: Record<FormStatus, string> = { none: 'ยังไม่กรอก', draft: 'ร่าง', saved: 'บันทึกแล้ว' }
const RANK: Record<FormStatus, number> = { none: 0, draft: 1, saved: 2 }

function Badge({ status }: { status: FormStatus }) {
  return <span className={`badge badge-${status}`}>{LABEL[status]}</span>
}

export default function Home() {
  const [date, setDate] = useState(localToday)
  const [barId, setBarId] = useState<string | null>(null)

  const statusOf = (id: string) => repo.statusFor(id, date)
  const selected = barId ? statusOf(barId) : null

  return (
    <main className="page page-home" data-testid="home">
      <header className="brand">
        <img className="brand-logo" src={LOGO} alt="Katathani Phuket Beach Resort" width={480} height={474} />
        <h1 className="brand-title">Barcheck</h1>
        <Wave className="wave brand-wave" />
      </header>

      <label className="field field-date">
        <span>วันที่</span>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>

      <div className="bar-grid">
        {BARS.map((b) => {
          const s = statusOf(b.id)
          const top: FormStatus = RANK[s.report] >= RANK[s.req] ? s.report : s.req
          return (
            <button
              key={b.id}
              type="button"
              className="bar-btn"
              aria-pressed={barId === b.id}
              onClick={() => setBarId(b.id)}
            >
              <span className="bar-name">{b.name}</span>
              <Badge status={top} />
            </button>
          )
        })}
      </div>

      {barId && selected && (
        <div className="form-links">
          <Link className="btn btn-tile" to={`/bar/${barId}/${date}/report`}>
            <IconReport />
            <span className="tile-label">Bar Report</span>
            <Badge status={selected.report} />
          </Link>
          <Link className="btn btn-tile" to={`/bar/${barId}/${date}/requisition`}>
            <IconRequisition />
            <span className="tile-label">ใบเบิก</span>
            <Badge status={selected.req} />
          </Link>
        </div>
      )}

      <p className="home-monthly">
        <Link className="btn btn-plain btn-monthly" to="/monthly">
          <IconCalendar />
          สรุปรายเดือน
        </Link>
      </p>
    </main>
  )
}
