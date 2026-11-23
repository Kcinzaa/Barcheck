// Responsive check + screenshots for Barcheck (Task 10; Task 11 redesign).
//
// Usage:
//   npx vite --port 5199 --host 127.0.0.1 &      # start the dev server first
//   NODE_PATH=$(npm root -g) node scripts/screenshots.mjs [outDir] [baseUrl]
//
// outDir defaults to os.tmpdir(); baseUrl defaults to http://127.0.0.1:5199.
// Writes PNGs to outDir (never inside the repo) and prints a JSON report of
// layout checks at 390px (plus page scrollWidth at 320px under "width320"): horizontal page scroll, touch targets < 44px,
// elements overflowing the viewport, item names that do not wrap, and the
// fixed save bar covering the last row.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const outDir = path.resolve(process.argv[2] ?? os.tmpdir())
const base = (process.argv[3] ?? 'http://127.0.0.1:5199').replace(/\/$/, '')
mkdirSync(outDir, { recursive: true })

const pad = (n) => String(n).padStart(2, '0')
const now = new Date()
const month = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const today = `${month}-${pad(now.getDate())}`
// Up to four distinct days in the current month, ending today.
const days = [...new Set([1, 2, 3].map((k) => Math.max(1, now.getDate() - k)))].map((d) => `${month}-${pad(d)}`)

const row = (itemCode, o = {}) => ({
  itemCode,
  openBtl: 0,
  openOz: 0,
  dailyStore: 0,
  transferIn: 0,
  transferOut: 0,
  sale: 0,
  remark: '',
  ...o,
})

function buildSeed() {
  const data = {}
  const report = (barId, date, status, rows, reportBy = 'สมชาย') =>
    (data[`barcheck:report:${barId}:${date}`] = { barId, date, reportBy, status, rows })
  const req = (barId, date, status, rows) =>
    (data[`barcheck:req:${barId}:${date}`] = {
      barId,
      date,
      requestedBy: 'สมชาย ใจดี',
      approvedBy: 'Manager',
      issuedBy: '',
      status,
      rows,
    })

  // Earlier days for The Cove: one draft day so Monthly shows the draft note.
  days.forEach((d, i) =>
    report('the-cove', d, i === 1 ? 'draft' : 'saved', [
      row('B001', { openBtl: 3, openOz: 4, sale: 8 + i }),
      row('B009', { openBtl: 5, sale: 20 + i * 3, dailyStore: i === 0 ? 23 : 0 }),
      row('B154', { openBtl: 2, sale: 5, transferOut: i === 2 ? 3 : 0 }),
      row('B193', { openBtl: 4, openOz: 10, sale: 12, remark: i === 0 ? 'ขวดแตก 1' : '' }),
    ]),
  )
  // Today, The Cove: saved; B001 sold more than stock (negative), B002 counted with variance.
  report('the-cove', today, 'saved', [
    row('B001', { openBtl: 1, sale: 30 }),
    row('B002', { openBtl: 2, sale: 10, countedBtl: 1, countedOz: 5 }),
    row('B009', { openBtl: 4, openOz: 6, sale: 18 }),
    row('B154', { openBtl: 2, openOz: 1, sale: 4 }),
  ])
  report('mango', today, 'draft', [row('B010', { openBtl: 2, sale: 6 })], 'Nok')
  req('the-cove', today, 'draft', [
    { itemCode: '18900005', qty: 2 },
    { itemCode: '19100006', qty: 12 },
    { itemCode: '16800043', qty: 3.5 },
  ])
  req('mango', today, 'saved', [{ itemCode: '15200009', qty: 1 }])
  return data
}

const contexts = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
}

/** Layout checks run in the page. */
function auditPage() {
  const vw = window.innerWidth
  const out = { scrollWidth: document.documentElement.scrollWidth, innerWidth: vw }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const desc = (el) => {
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40)
    return `${el.tagName.toLowerCase()}${cls}${el.type ? `[type=${el.type}]` : ''} "${label}"`
  }
  const small = []
  for (const el of document.querySelectorAll('button, a, input, select, summary, [role=button]')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.height < 44 - 0.5 || r.width < 44 - 0.5)
      small.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`)
  }
  out.smallTargets = [...new Set(small)]

  const inScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true
    }
    return false
  }
  const over = []
  for (const el of document.body.querySelectorAll('*')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if ((r.right > vw + 0.5 || r.left < -0.5) && !inScroller(el)) over.push(`${desc(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`)
  }
  out.overflowing = over.slice(0, 20)

  const unwrapped = []
  for (const el of document.querySelectorAll('.ic-name, .req-name, .m-name, h1')) {
    if (!visible(el)) continue
    if (el.scrollWidth > el.clientWidth + 1) unwrapped.push(desc(el))
  }
  out.unwrappedNames = unwrapped

  // Latin words split across lines ("Camp|ari"): a word whose range has rects on two lines.
  const broken = []
  for (const el of document.querySelectorAll('.ic-name, .req-name, .m-name')) {
    if (!visible(el)) continue
    const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE)
    if (!node) continue
    // Latin tokens only: Thai has no spaces and legitimately breaks between dictionary words.
    const re = /[A-Za-z0-9'.&()/-]{2,}/g
    let m
    while ((m = re.exec(node.data))) {
      const range = document.createRange()
      range.setStart(node, m.index)
      range.setEnd(node, m.index + m[0].length)
      const tops = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
      if (tops.size > 1) {
        broken.push(`${desc(el)} word "${m[0]}"`)
        break
      }
    }
  }
  out.brokenWords = broken.slice(0, 10)

  const footer = document.querySelector('.report-footer')
  if (footer) {
    window.scrollTo(0, document.documentElement.scrollHeight)
    const rowsEls = document.querySelectorAll('.item-card, .req-row')
    const last = rowsEls[rowsEls.length - 1]
    if (last) {
      const lb = last.getBoundingClientRect().bottom
      const ft = footer.getBoundingClientRect().top
      out.footerCoversLast = lb > ft + 0.5 ? `last row bottom ${Math.round(lb)} > footer top ${Math.round(ft)}` : false
    }
    window.scrollTo(0, 0)
  }
  return out
}

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`)
  await page.waitForTimeout(250) // let ≤200 ms state transitions (chevrons, progress) settle
  await page.screenshot({ path: file })
  console.error('wrote', file)
}

async function scrollToTestId(page, testId, offset = 70) {
  await page.evaluate(
    ([id, off]) => {
      const el = document.querySelector(`[data-testid="${id}"]`)
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off)
    },
    [testId, offset],
  )
}

const browser = await chromium.launch()
const audit = {}
const seed = buildSeed()
for (const [kind, opts] of Object.entries(contexts)) {
  const ctx = await browser.newContext(opts)
  const page = await ctx.newPage()
  const go = async (route) => {
    await page.goto(base + route)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.evaluate(() => document.fonts.ready)
  }
  const check = async (key) => {
    if (kind === 'mobile') audit[key] = await page.evaluate(auditPage)
  }

  // Seed localStorage through the page, then reload so pages read it.
  await go('/')
  await page.evaluate((d) => {
    localStorage.clear()
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, JSON.stringify(v))
  }, seed)

  // Home with a bar selected.
  await go('/')
  await page.getByRole('button', { name: /The Cove/ }).click()
  await check('home')
  await shot(page, `${kind}-home`)

  // Bar Report.
  const report = `/bar/the-cove/${today}/report`
  await go(report)
  await check('report')
  await shot(page, `${kind}-report-top`)
  await scrollToTestId(page, 'item-B001')
  await shot(page, `${kind}-report-warnings`)
  // Expand "more" on the long-named item.
  await page.locator('[data-testid="item-B154"] .ic-more-toggle').click()
  await check('report-more') // (the audit scrolls; run it before positioning the shot)
  await scrollToTestId(page, 'item-B154')
  await shot(page, `${kind}-report-more`)
  await go(report)
  await page.getByRole('searchbox', { name: 'ค้นหาสินค้า' }).fill('wine')
  await check('report-search')
  await shot(page, `${kind}-report-search`)
  // Bottom of the page: the fixed save bar must not cover the last card.
  await page.getByRole('searchbox', { name: 'ค้นหาสินค้า' }).fill('')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await shot(page, `${kind}-report-bottom`)

  // Requisition.
  const req = `/bar/the-cove/${today}/requisition`
  await go(req)
  await check('requisition')
  await shot(page, `${kind}-requisition`)
  await page.getByRole('searchbox', { name: 'ค้นหาสินค้า' }).fill('น้ำผึ้ง')
  await check('requisition-search')
  await page.getByRole('searchbox', { name: 'ค้นหาสินค้า' }).fill('')
  await scrollToTestId(page, 'req-18900005', 140)
  await shot(page, `${kind}-requisition-long`)

  // Monthly: table, expanded row, empty state.
  await go('/monthly')
  await check('monthly')
  await shot(page, `${kind}-monthly`)
  await page.locator('[data-testid="sum-B009"] .m-toggle').click()
  await check('monthly-expanded')
  await shot(page, `${kind}-monthly-expanded`)
  await page.getByRole('combobox').selectOption('palm')
  await check('monthly-empty')
  await shot(page, `${kind}-monthly-empty`)

  await ctx.close()
}
// Narrowest phones: no horizontal page scroll at 320px on any screen.
{
  const ctx = await browser.newContext({ ...contexts.mobile, viewport: { width: 320, height: 640 } })
  const page = await ctx.newPage()
  await page.goto(base + '/')
  await page.evaluate((d) => {
    localStorage.clear()
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, JSON.stringify(v))
  }, seed)
  const w320 = {}
  for (const route of ['/', `/bar/the-cove/${today}/report`, `/bar/the-cove/${today}/requisition`, '/monthly']) {
    await page.goto(base + route)
    await page.waitForLoadState('networkidle').catch(() => {})
    if (route === '/') await page.getByRole('button', { name: /The Cove/ }).click()
    w320[route] = await page.evaluate(() => document.documentElement.scrollWidth)
  }
  audit.width320 = w320
  await ctx.close()
}
await browser.close()
console.log(JSON.stringify(audit, null, 2))
