import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Monthly from './Monthly'
import { BARS } from '../data/bars'
import { ITEMS } from '../data/items'
import { repo } from '../storage/repo'
import type { BarReportRow } from '../domain/types'

const BAR_ITEMS = ITEMS.filter((i) => i.form === 'bar')
const item25 = BAR_ITEMS.find((i) => i.sizeOz === 25)!
const item23 = BAR_ITEMS.find((i) => i.sizeOz === 23)!

function localMonth(offset = 0): string {
  const d = new Date()
  const m = new Date(d.getFullYear(), d.getMonth() + offset, 1)
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
}

const row = (itemCode: string, patch: Partial<BarReportRow> = {}): BarReportRow => ({
  itemCode,
  openBtl: 0,
  openOz: 0,
  dailyStore: 0,
  transferIn: 0,
  transferOut: 0,
  sale: 0,
  remark: '',
  ...patch,
})

function seed(barId: string, date: string, rows: BarReportRow[], status: 'draft' | 'saved' = 'saved') {
  repo.saveReport({ barId, date, reportBy: '', status, rows })
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <Monthly />
    </MemoryRouter>,
  )

const barSelect = () => screen.getByLabelText('บาร์') as HTMLSelectElement
const monthInput = () => screen.getByLabelText('เดือน') as HTMLInputElement
const exportBtn = () => screen.getByRole('button', { name: 'Export Excel' }) as HTMLButtonElement
const EMPTY = 'ยังไม่มีข้อมูลเดือนนี้'
const BAR = BARS[0].id
const M = localMonth()

describe('Monthly', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the heading, lists all bars and defaults to the local month', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'สรุปรายเดือน' })).toBeTruthy()
    expect(barSelect().options).toHaveLength(12)
    expect(barSelect().value).toBe(BAR)
    expect(monthInput().value).toBe(M)
  })

  it('shows the empty state and disables export for an empty month', () => {
    renderPage()
    expect(screen.getByText(EMPTY)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(exportBtn().disabled).toBe(true)
  })

  it('shows the empty state when the month has only untouched rows', () => {
    seed(BAR, `${M}-01`, [row(item25.code), row(item23.code)])
    renderPage()
    expect(screen.getByText(EMPTY)).toBeTruthy()
    expect(exportBtn().disabled).toBe(true)
  })

  it('summarises an item and expands its daily rows', () => {
    seed(BAR, `${M}-01`, [row(item25.code, { openBtl: 2, sale: 10 })])
    seed(BAR, `${M}-02`, [row(item25.code, { openBtl: 1, openOz: 15, sale: 5 })])
    renderPage()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(exportBtn().disabled).toBe(false)
    const r = screen.getByTestId(`sum-${item25.code}`)
    expect(within(r).getByTestId('days').textContent).toBe('2')
    expect(within(r).getByTestId('sale').textContent).toContain('0 ขวด 15 oz')
    expect(within(r).getByTestId('sale').textContent).toContain('15 oz')
    expect(within(r).getByTestId('closed').textContent).toContain('1 ขวด 10 oz') // 40 - 5 = 35
    expect(within(r).getByTestId('closed').textContent).toContain('35 oz')

    const toggle = within(r).getByRole('button', { name: new RegExp(item25.name) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId(`daily-${item25.code}`)).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const daily = screen.getByTestId(`daily-${item25.code}`)
    expect(daily.textContent).toContain(`${M}-01`)
    expect(daily.textContent).toContain(`${M}-02`)
    expect(within(daily).getAllByRole('row')).toHaveLength(3) // header + 2 days
    fireEvent.click(toggle)
    expect(screen.queryByTestId(`daily-${item25.code}`)).toBeNull()
  })

  it('notes recorded days and draft days', () => {
    seed(BAR, `${M}-01`, [row(item23.code, { sale: 1 })], 'draft')
    seed(BAR, `${M}-02`, [row(item23.code, { sale: 1 })], 'saved')
    seed(BAR, `${M}-03`, [row(item23.code, { sale: 1 })], 'draft')
    renderPage()
    expect(screen.getByText('บันทึกข้อมูล 3 วัน')).toBeTruthy()
    expect(screen.getByText('2 วันยังเป็นร่าง')).toBeTruthy()
  })

  it('omits the draft note when nothing is draft', () => {
    seed(BAR, `${M}-01`, [row(item23.code, { sale: 1 })], 'saved')
    renderPage()
    expect(screen.getByText('บันทึกข้อมูล 1 วัน')).toBeTruthy()
    expect(screen.queryByText(/ยังเป็นร่าง/)).toBeNull()
  })

  it('does not leak other bars or other months, and follows the selectors', () => {
    const other = BARS[1].id
    const prev = localMonth(-1)
    seed(other, `${M}-01`, [row(item25.code, { sale: 7 })])
    seed(BAR, `${prev}-28`, [row(item23.code, { sale: 3 })])
    renderPage()
    expect(screen.getByText(EMPTY)).toBeTruthy()
    expect(screen.queryByTestId(`sum-${item25.code}`)).toBeNull()

    fireEvent.change(barSelect(), { target: { value: other } })
    expect(screen.getByTestId(`sum-${item25.code}`)).toBeTruthy()
    expect(screen.queryByTestId(`sum-${item23.code}`)).toBeNull()

    fireEvent.change(barSelect(), { target: { value: BAR } })
    fireEvent.change(monthInput(), { target: { value: prev } })
    expect(screen.getByTestId(`sum-${item23.code}`)).toBeTruthy()
    expect(screen.queryByTestId(`sum-${item25.code}`)).toBeNull()
  })

  it('ignores a cleared month input', () => {
    renderPage()
    fireEvent.change(monthInput(), { target: { value: '' } })
    expect(monthInput().value).toBe(M)
  })
})
