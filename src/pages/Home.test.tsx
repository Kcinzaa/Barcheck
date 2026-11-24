import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'
import { BARS } from '../data/bars'
import { repo } from '../storage/repo'

function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  )
}

function seed(barId: string, date: string, status: 'draft' | 'saved') {
  repo.saveReport({ barId, date, reportBy: '', status, rows: [] })
}

const dateInput = () => screen.getByLabelText('วันที่') as HTMLInputElement
const barButton = (name: string) => screen.getByRole('button', { name: new RegExp(name) })

describe('Home', () => {
  beforeEach(() => localStorage.clear())

  it('shows a button per bar and the Barcheck heading', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: 'Barcheck' })).toBeTruthy()
    for (const b of BARS) expect(barButton(b.name)).toBeTruthy()
    expect(BARS.length).toBe(12)
  })

  it('defaults date to local today', () => {
    renderHome()
    expect(dateInput().value).toBe(localToday())
  })

  it('reveals report and requisition links on bar select', () => {
    renderHome()
    expect(screen.queryByRole('link', { name: /Bar Report/ })).toBeNull()
    const bar = BARS[0]
    fireEvent.click(barButton(bar.name))
    expect(barButton(bar.name).getAttribute('aria-pressed')).toBe('true')
    const date = localToday()
    expect(screen.getByRole('link', { name: /Bar Report/ }).getAttribute('href')).toBe(
      `/bar/${bar.id}/${date}/report`,
    )
    expect(screen.getByRole('link', { name: /ใบเบิก/ }).getAttribute('href')).toBe(
      `/bar/${bar.id}/${date}/requisition`,
    )
    expect(screen.getByRole('link', { name: 'สรุปรายเดือน' }).getAttribute('href')).toBe('/monthly')
  })

  it('shows saved and draft badges', () => {
    const today = localToday()
    seed(BARS[0].id, today, 'saved')
    seed(BARS[1].id, today, 'draft')
    renderHome()
    expect(barButton(BARS[0].name).textContent).toContain('บันทึกแล้ว')
    expect(barButton(BARS[1].name).textContent).toContain('ร่าง')
    expect(barButton(BARS[2].name).textContent).not.toContain('บันทึกแล้ว')
    expect(barButton(BARS[2].name).textContent).not.toContain('ร่าง')
  })

  it('updates badges and hrefs when the date changes', () => {
    seed(BARS[0].id, '2026-01-05', 'saved')
    renderHome()
    fireEvent.click(barButton(BARS[0].name))
    expect(barButton(BARS[0].name).textContent).not.toContain('บันทึกแล้ว')
    fireEvent.change(dateInput(), { target: { value: '2026-01-05' } })
    expect(barButton(BARS[0].name).textContent).toContain('บันทึกแล้ว')
    expect(screen.getByRole('link', { name: /Bar Report/ }).getAttribute('href')).toBe(
      `/bar/${BARS[0].id}/2026-01-05/report`,
    )
    expect(screen.getByRole('link', { name: /Bar Report/ }).textContent).toContain('บันทึกแล้ว')
    fireEvent.change(dateInput(), { target: { value: '2026-01-06' } })
    expect(barButton(BARS[0].name).textContent).not.toContain('บันทึกแล้ว')
    expect(screen.getByRole('link', { name: /Bar Report/ }).getAttribute('href')).toBe(
      `/bar/${BARS[0].id}/2026-01-06/report`,
    )
  })
})
