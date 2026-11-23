import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import BarReport from './BarReport'
import { ITEMS } from '../data/items'
import { repo } from '../storage/repo'

const BAR_ITEMS = ITEMS.filter((i) => i.form === 'bar')
const N = BAR_ITEMS.length
const item25 = BAR_ITEMS.find((i) => i.sizeOz === 25)!
const item23 = BAR_ITEMS.find((i) => i.sizeOz === 23)!
const BAR = 'the-cove'
const DATE = '2026-11-23'

function renderPage(barId = BAR, date = DATE) {
  return render(
    <MemoryRouter initialEntries={[`/bar/${barId}/${date}/report`]}>
      <Routes>
        <Route path="/bar/:barId/:date/report" element={<BarReport />} />
      </Routes>
    </MemoryRouter>,
  )
}

const card = (code: string) => screen.getByTestId(`item-${code}`)
const MORE = /^เพิ่มเติม/
/** Finds a field in a card, expanding the card's secondary fields (Store/Transfer/นับจริง) if needed. */
const field = (code: string, label: string) => {
  const c = within(card(code))
  const found = c.queryByLabelText(label)
  if (found) return found as HTMLInputElement
  fireEvent.click(c.getByRole('button', { name: MORE }))
  return c.getByLabelText(label) as HTMLInputElement
}
const reportByInput = () => within(screen.getByTestId('report-head')).getByLabelText('ผู้รายงาน') as HTMLInputElement
const searchInput = () => within(screen.getByTestId('report-sticky')).getByLabelText('ค้นหาสินค้า')
const type = (code: string, label: string, value: string) =>
  fireEvent.change(field(code, label), { target: { value } })
const closedText = (code: string) => screen.getByTestId(`closed-${code}`).textContent
const counter = () => screen.getByTestId('counter').textContent

describe('BarReport', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.useRealTimers())

  it('computes closed from open + sale on a 25 oz item', () => {
    renderPage()
    type(item25.code, 'Open ขวด', '1')
    type(item25.code, 'Open oz', '8')
    type(item25.code, 'Sale oz', '10')
    expect(closedText(item25.code)).toBe('0 ขวด 23 oz')
  })

  it('warns when sale exceeds stock', () => {
    renderPage()
    expect(within(card(item25.code)).queryByTestId('negative-warning')).toBeNull()
    type(item25.code, 'Open oz', '5')
    type(item25.code, 'Sale oz', '10')
    const warn = within(card(item25.code)).getByTestId('negative-warning')
    expect(warn.getAttribute('role')).toBe('alert')
    expect(screen.getByTestId(`closed-${item25.code}`).className).toContain('negative')
  })

  it('shows variance warning when counted differs from computed', () => {
    renderPage()
    type(item25.code, 'Open ขวด', '1')
    type(item25.code, 'Open oz', '8')
    type(item25.code, 'Sale oz', '10')
    expect(within(card(item25.code)).queryByTestId('variance')).toBeNull()
    type(item25.code, 'นับจริง oz', '22')
    const v = within(card(item25.code)).getByTestId('variance')
    expect(v.getAttribute('role')).toBe('alert')
    expect(v.textContent).toContain('−1 oz')
  })

  it('no variance warning when counted matches', () => {
    renderPage()
    type(item25.code, 'Open oz', '23')
    type(item25.code, 'นับจริง oz', '23')
    expect(within(card(item25.code)).queryByTestId('variance')).toBeNull()
  })

  it('stores comma decimals as numbers', () => {
    renderPage()
    type(item25.code, 'Sale oz', '7,5')
    type(item25.code, 'Open oz', '10')
    expect(closedText(item25.code)).toBe('0 ขวด 2.5 oz')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    const row = repo.getReport(BAR, DATE)!.rows.find((r) => r.itemCode === item25.code)!
    expect(row.sale).toBe(7.5)
  })

  it('stores bottle+oz movements as oz', () => {
    renderPage()
    type(item25.code, 'Daily Store ขวด', '2')
    type(item25.code, 'Daily Store oz', '3')
    type(item25.code, 'Transfer In oz', '4')
    type(item25.code, 'Transfer Out ขวด', '1')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    const row = repo.getReport(BAR, DATE)!.rows.find((r) => r.itemCode === item25.code)!
    expect(row.dailyStore).toBe(53)
    expect(row.transferIn).toBe(4)
    expect(row.transferOut).toBe(25)
    expect(closedText(item25.code)).toBe('1 ขวด 7 oz')
  })

  it('blank or invalid input never renders NaN', () => {
    renderPage()
    type(item25.code, 'Open oz', '')
    type(item25.code, 'Sale oz', 'abc')
    type(item25.code, 'นับจริง ขวด', '')
    type(item25.code, 'Daily Store oz', '-')
    expect(document.body.textContent).not.toContain('NaN')
    for (const input of document.querySelectorAll('input')) {
      expect(input.value).not.toContain('NaN')
    }
    expect(closedText(item25.code)).toBe('0 ขวด 0 oz')
  })

  it('normalises oz overflow in computed closed', () => {
    renderPage()
    type(item23.code, 'Open oz', '30')
    expect(closedText(item23.code)).toBe('1 ขวด 7 oz')
  })

  it('stepper buttons change value and never go below 0', () => {
    renderPage()
    const c = within(card(item25.code))
    fireEvent.click(c.getByRole('button', { name: 'เพิ่ม Open ขวด' }))
    fireEvent.click(c.getByRole('button', { name: 'เพิ่ม Open ขวด' }))
    expect(field(item25.code, 'Open ขวด').value).toBe('2')
    fireEvent.click(c.getByRole('button', { name: 'ลด Open ขวด' }))
    fireEvent.click(c.getByRole('button', { name: 'ลด Open ขวด' }))
    fireEvent.click(c.getByRole('button', { name: 'ลด Open ขวด' }))
    expect(closedText(item25.code)).toBe('0 ขวด 0 oz')
  })

  it('secondary fields are collapsed by default and toggle open', () => {
    renderPage()
    const c = within(card(item25.code))
    const more = c.getByRole('button', { name: MORE })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(c.queryByLabelText('Daily Store ขวด')).toBeNull()
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(c.getByLabelText('Daily Store ขวด')).toBeTruthy()
  })

  it('clearing counted removes the variance', () => {
    renderPage()
    type(item25.code, 'Open oz', '10')
    type(item25.code, 'นับจริง oz', '8')
    expect(within(card(item25.code)).getByTestId('variance').textContent).toContain('−2 oz')
    fireEvent.click(within(card(item25.code)).getByRole('button', { name: 'ล้างค่านับ' }))
    expect(within(card(item25.code)).queryByTestId('variance')).toBeNull()
  })

  it('numeric inputs use decimal keypad', () => {
    renderPage()
    expect(field(item25.code, 'Open oz').getAttribute('inputmode')).toBe('decimal')
    expect(field(item25.code, 'Transfer Out ขวด').getAttribute('inputmode')).toBe('decimal')
  })

  it('search filters cards by name and hides empty categories', () => {
    renderPage()
    const bacardi = BAR_ITEMS.filter((i) => /bacardi/i.test(i.name))
    expect(bacardi.length).toBeGreaterThan(0)
    fireEvent.change(searchInput(), { target: { value: 'bacardi' } })
    const cards = screen.getAllByTestId(/^item-/)
    expect(cards.length).toBe(bacardi.length)
    for (const i of bacardi) expect(card(i.code)).toBeTruthy()
    const gin = BAR_ITEMS.find((i) => i.category === 'GIN')!
    expect(screen.queryByTestId(`item-${gin.code}`)).toBeNull()
    expect(screen.queryByRole('heading', { name: /^GIN/ })).toBeNull()
  })

  it('category sections collapse and expand', () => {
    renderPage()
    const toggle = screen.getByRole('button', { name: new RegExp(`^${item25.category}`) })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId(`item-${item25.code}`)).toBeNull()
    fireEvent.click(toggle)
    expect(card(item25.code)).toBeTruthy()
  })

  it('counter counts only touched rows', () => {
    renderPage()
    expect(counter()).toBe(`กรอกแล้ว 0/${N}`)
    type(item25.code, 'Sale oz', '3')
    type(item25.code, 'Open oz', '4')
    expect(counter()).toBe(`กรอกแล้ว 1/${N}`)
    type(item25.code, 'Sale oz', '')
    type(item25.code, 'Open oz', '0')
    expect(counter()).toBe(`กรอกแล้ว 0/${N}`)
  })

  it('debounces draft autosave by 300 ms', () => {
    vi.useFakeTimers()
    renderPage()
    type(item25.code, 'Sale oz', '4')
    expect(repo.getReport(BAR, DATE)).toBeNull()
    act(() => vi.advanceTimersByTime(299))
    expect(repo.getReport(BAR, DATE)).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    const rec = repo.getReport(BAR, DATE)!
    expect(rec.status).toBe('draft')
    expect(rec.rows).toHaveLength(1)
    expect(rec.rows[0]).toMatchObject({ itemCode: item25.code, sale: 4 })
  })

  it('flushes draft on unmount and restores it on remount', () => {
    const { unmount } = renderPage()
    fireEvent.change(reportByInput(), { target: { value: 'Somchai' } })
    type(item25.code, 'Open ขวด', '1')
    type(item25.code, 'Open oz', '8')
    type(item25.code, 'Daily Store oz', '30')
    unmount()
    const rec = repo.getReport(BAR, DATE)!
    expect(rec.status).toBe('draft')
    expect(rec.reportBy).toBe('Somchai')
    renderPage()
    expect(reportByInput().value).toBe('Somchai')
    expect(field(item25.code, 'Open ขวด').value).toBe('1')
    expect(field(item25.code, 'Open oz').value).toBe('8')
    const more = within(card(item25.code)).getByRole('button', { name: MORE })
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(field(item25.code, 'Daily Store ขวด').value).toBe('1')
    expect(field(item25.code, 'Daily Store oz').value).toBe('5')
    expect(counter()).toBe(`กรอกแล้ว 1/${N}`)
  })

  it('save stores status saved and shows confirmation', () => {
    renderPage()
    type(item25.code, 'Sale oz', '2')
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    expect(repo.getReport(BAR, DATE)!.status).toBe('saved')
    expect(screen.getByRole('status').textContent).toContain('บันทึกแล้ว')
  })

  it('opening a saved record without editing does not write', () => {
    repo.saveReport({
      barId: BAR,
      date: DATE,
      reportBy: 'A',
      status: 'saved',
      rows: [{ itemCode: item25.code, openBtl: 0, openOz: 0, dailyStore: 0, transferIn: 0, transferOut: 0, sale: 3, remark: '' }],
    })
    const spy = vi.spyOn(repo, 'saveReport')
    const { unmount } = renderPage()
    unmount()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    expect(repo.getReport(BAR, DATE)!.status).toBe('saved')
  })

  it('editing a saved record makes it draft again', () => {
    repo.saveReport({ barId: BAR, date: DATE, reportBy: '', status: 'saved', rows: [] })
    const { unmount } = renderPage()
    type(item25.code, 'Sale oz', '1')
    unmount()
    expect(repo.getReport(BAR, DATE)!.status).toBe('draft')
  })

  it('ignores unknown and malformed stored rows without crashing', () => {
    localStorage.setItem(
      `barcheck:report:${BAR}:${DATE}`,
      JSON.stringify({
        barId: BAR,
        date: DATE,
        reportBy: 'x',
        status: 'draft',
        rows: [
          { itemCode: 'GONE-999', sale: 5 },
          { itemCode: item25.code, openOz: 'bad', sale: 2 },
        ],
      }),
    )
    renderPage()
    expect(closedText(item25.code)).toBe('0 ขวด -2 oz')
    expect(document.body.textContent).not.toContain('NaN')
    expect(counter()).toBe(`กรอกแล้ว 1/${N}`)
    expect(screen.queryByTestId('item-GONE-999')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
    const codes = repo.getReport(BAR, DATE)!.rows.map((r) => r.itemCode)
    expect(codes).toContain('GONE-999') // not shown, but never silently dropped
  })

  it('shows header with bar name, date and links', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /The Cove/ })).toBeTruthy()
    expect(screen.getByText(DATE)).toBeTruthy()
    expect(screen.getByRole('link', { name: '← หน้าหลัก' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: /ใบเบิก/ }).getAttribute('href')).toBe(
      `/bar/${BAR}/${DATE}/requisition`,
    )
  })

  it('unknown bar shows a friendly message', () => {
    const spy = vi.spyOn(repo, 'saveReport')
    renderPage('nope', DATE)
    expect(screen.getByText(/ไม่พบบาร์/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '← หน้าหลัก' })).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('invalid date shows a friendly message', () => {
    const spy = vi.spyOn(repo, 'saveReport')
    const { unmount } = renderPage(BAR, '2026-13-45')
    expect(screen.getByText(/วันที่ไม่ถูกต้อง/)).toBeTruthy()
    unmount()
    renderPage(BAR, 'yesterday')
    expect(screen.getByText(/วันที่ไม่ถูกต้อง/)).toBeTruthy()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  describe('prefill Open from the previous Closed', () => {
    const PREV = '2026-11-21'
    const NOTE = `เติมจากวันที่ ${PREV}`
    const blank = { openBtl: 0, openOz: 0, dailyStore: 0, transferIn: 0, transferOut: 0, sale: 0, remark: '' }
    const note = (code: string) => within(card(code)).queryByTestId('open-from')
    const savedRow = (code: string, date = DATE) => repo.getReport(BAR, date)?.rows.find((r) => r.itemCode === code)
    const seedPrev = () =>
      repo.saveReport({
        barId: BAR,
        date: PREV,
        reportBy: 'A',
        status: 'draft',
        rows: [
          // closed = 1 btl 8 oz − 10 oz = 23 oz
          { itemCode: item25.code, ...blank, openBtl: 1, openOz: 8, sale: 10 },
          // counted wins over computed
          { itemCode: item23.code, ...blank, openBtl: 5, sale: 1, countedBtl: 1, countedOz: 2 },
        ],
      })

    it('a new date shows the prefilled Open and the note; counter stays 0', () => {
      seedPrev()
      renderPage()
      expect(field(item25.code, 'Open ขวด').value).toBe('')
      expect(field(item25.code, 'Open oz').value).toBe('23')
      expect(closedText(item25.code)).toBe('0 ขวด 23 oz')
      expect(note(item25.code)?.textContent).toBe(NOTE)
      expect(field(item23.code, 'Open ขวด').value).toBe('1')
      expect(field(item23.code, 'Open oz').value).toBe('2')
      expect(note(item23.code)?.textContent).toBe(NOTE)
      const other = BAR_ITEMS.find((i) => i.code !== item25.code && i.code !== item23.code)!
      expect(note(other.code)).toBeNull()
      expect(counter()).toBe(`กรอกแล้ว 0/${N}`)
    })

    it('opening a prefilled page writes nothing', () => {
      vi.useFakeTimers()
      seedPrev()
      const spy = vi.spyOn(repo, 'saveReport')
      const { unmount } = renderPage()
      act(() => vi.advanceTimersByTime(1000))
      unmount()
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
      expect(repo.getReport(BAR, DATE)).toBeNull()
    })

    it('editing Sale stores the row with the prefilled Open and openFrom', () => {
      vi.useFakeTimers()
      seedPrev()
      renderPage()
      type(item25.code, 'Sale oz', '5')
      act(() => vi.advanceTimersByTime(300))
      expect(savedRow(item25.code)).toEqual({ itemCode: item25.code, ...blank, openOz: 23, sale: 5, openFrom: PREV })
      expect(repo.getReport(BAR, DATE)!.rows).toHaveLength(1) // prefilled-only rows are not stored
      expect(note(item25.code)?.textContent).toBe(NOTE)
      expect(counter()).toBe(`กรอกแล้ว 1/${N}`)
      expect(closedText(item25.code)).toBe('0 ขวด 18 oz')
    })

    it('editing a secondary field keeps openFrom and the note', () => {
      seedPrev()
      renderPage()
      type(item25.code, 'Remark', 'spill')
      expect(note(item25.code)?.textContent).toBe(NOTE)
      fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(savedRow(item25.code)).toMatchObject({ openOz: 23, remark: 'spill', openFrom: PREV })
    })

    it('clearing the only other entry makes the row untouched again', () => {
      seedPrev()
      renderPage()
      type(item25.code, 'Sale oz', '5')
      expect(counter()).toBe(`กรอกแล้ว 1/${N}`)
      type(item25.code, 'Sale oz', '')
      expect(counter()).toBe(`กรอกแล้ว 0/${N}`)
      expect(note(item25.code)?.textContent).toBe(NOTE)
    })

    it('typing Open by hand clears the note and openFrom', () => {
      seedPrev()
      renderPage()
      type(item25.code, 'Open oz', '20')
      expect(note(item25.code)).toBeNull()
      expect(counter()).toBe(`กรอกแล้ว 1/${N}`)
      fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
      const row = savedRow(item25.code)!
      expect(row).toEqual({ itemCode: item25.code, ...blank, openOz: 20 })
      expect('openFrom' in row).toBe(false)
    })

    it('re-typing the same Open value still makes it user-entered', () => {
      seedPrev()
      renderPage()
      type(item25.code, 'Open oz', '23.0') // same number, typed by hand
      expect(note(item25.code)).toBeNull()
      expect(counter()).toBe(`กรอกแล้ว 1/${N}`)
    })

    it('the Open stepper also clears the note and openFrom', () => {
      seedPrev()
      renderPage()
      fireEvent.click(within(card(item25.code)).getByRole('button', { name: 'เพิ่ม Open ขวด' }))
      expect(note(item25.code)).toBeNull()
      expect(field(item25.code, 'Open ขวด').value).toBe('1')
      expect(field(item25.code, 'Open oz').value).toBe('23')
      fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
      const row = savedRow(item25.code)!
      expect(row).toEqual({ itemCode: item25.code, ...blank, openBtl: 1, openOz: 23 })
      expect('openFrom' in row).toBe(false)
    })

    it('an existing stored row is never overwritten; items without one are prefilled', () => {
      seedPrev()
      repo.saveReport({
        barId: BAR,
        date: DATE,
        reportBy: '',
        status: 'saved',
        rows: [{ itemCode: item25.code, ...blank, openOz: 4, sale: 1 }],
      })
      renderPage()
      expect(field(item25.code, 'Open oz').value).toBe('4')
      expect(note(item25.code)).toBeNull()
      expect(field(item23.code, 'Open ขวด').value).toBe('1')
      expect(note(item23.code)?.textContent).toBe(NOTE)
      expect(counter()).toBe(`กรอกแล้ว 1/${N}`)
    })

    it('a date earlier than all records has no prefill', () => {
      seedPrev()
      renderPage(BAR, '2026-11-20')
      expect(field(item25.code, 'Open oz').value).toBe('')
      expect(screen.queryAllByTestId('open-from')).toHaveLength(0)
    })

    it('the same date as the latest record is not prefilled from itself', () => {
      seedPrev()
      renderPage(BAR, PREV)
      expect(field(item25.code, 'Open ขวด').value).toBe('1')
      expect(field(item25.code, 'Open oz').value).toBe('8')
      expect(screen.queryAllByTestId('open-from')).toHaveLength(0)
    })

    it('a stored row keeps its openFrom across reloads; a malformed one is dropped', () => {
      repo.saveReport({
        barId: BAR,
        date: DATE,
        reportBy: '',
        status: 'draft',
        rows: [
          { itemCode: item25.code, ...blank, openOz: 23, sale: 5, openFrom: PREV },
          { itemCode: item23.code, ...blank, openOz: 7, openFrom: 'bad' as string },
        ],
      })
      renderPage()
      expect(note(item25.code)?.textContent).toBe(NOTE)
      expect(note(item23.code)).toBeNull()
      expect(field(item23.code, 'Open oz').value).toBe('7')
      expect(counter()).toBe(`กรอกแล้ว 2/${N}`)
      expect(document.body.textContent).not.toContain('NaN')
    })

    it('chains across a day off from the latest earlier record', () => {
      seedPrev()
      renderPage(BAR, '2026-11-25')
      expect(field(item25.code, 'Open oz').value).toBe('23')
      expect(note(item25.code)?.textContent).toBe(NOTE)
    })
  })

  describe('storage failure', () => {
    const ERR = /บันทึกไม่สำเร็จ/
    const failing = () =>
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError')
      })
    afterEach(() => vi.restoreAllMocks())

    it('explicit save shows an alert, not the saved tick', () => {
      failing()
      renderPage()
      type(item25.code, 'Sale oz', '4')
      fireEvent.click(screen.getByRole('button', { name: 'บันทึก' }))
      expect(screen.getByText(ERR).getAttribute('role')).toBe('alert')
      expect(document.body.textContent).not.toContain('บันทึกแล้ว')
    })

    it('a failed autosave stays dirty and the next edit writes the latest state', () => {
      vi.useFakeTimers()
      const spy = failing()
      renderPage()
      type(item25.code, 'Sale oz', '4')
      act(() => vi.advanceTimersByTime(300))
      expect(document.body.textContent).toMatch(ERR)
      expect(repo.getReport(BAR, DATE)).toBeNull()
      spy.mockRestore()
      type(item25.code, 'Sale oz', '5')
      expect(document.body.textContent).not.toMatch(ERR)
      act(() => vi.advanceTimersByTime(300))
      expect(repo.getReport(BAR, DATE)!.rows[0]).toMatchObject({ itemCode: item25.code, sale: 5 })
    })

    it('a failed autosave is retried on unmount once storage works', () => {
      vi.useFakeTimers()
      const spy = failing()
      const { unmount } = renderPage()
      type(item25.code, 'Sale oz', '4')
      act(() => vi.advanceTimersByTime(300))
      spy.mockRestore()
      unmount()
      expect(repo.getReport(BAR, DATE)!.rows[0]).toMatchObject({ itemCode: item25.code, sale: 4 })
    })
  })
})
