/** Decorative inline SVGs (aria-hidden): they never change an accessible name. */

const svg = {
  'aria-hidden': true as const,
  focusable: 'false' as const,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Thin sand-and-sun wave, echoing the Katathani logo. */
export function Wave({ className = 'wave' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 16" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 10 C 40 3, 80 3, 120 9 S 200 15, 240 8 S 300 3, 320 7" fill="none" stroke="var(--sand)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path d="M0 13 C 50 7, 90 8, 130 12 S 210 15, 250 11 S 300 8, 320 10" fill="none" stroke="var(--sun)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Clipboard with tally lines: the daily bar report. */
export function IconReport() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" {...svg}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" />
    </svg>
  )
}

/** Crate with a bottle: the store requisition. */
export function IconRequisition() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" {...svg}>
      <path d="M3.5 12h17l-1.6 8.2a1 1 0 0 1-1 .8H6.1a1 1 0 0 1-1-.8Z" />
      <path d="M10 12V7.5c0-.8.5-1.4 1-1.9V3h2v2.6c.5.5 1 1.1 1 1.9V12" />
      <path d="M8 16h8" />
    </svg>
  )
}

/** Month grid: the monthly summary. */
export function IconCalendar() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" {...svg}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 9.5h16M8.5 3v4M15.5 3v4" />
      <path d="M8 13h2M12 13h2M16 13h0M8 16.5h2M12 16.5h2" />
    </svg>
  )
}

export function IconDownload() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" {...svg} strokeWidth={1.9}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </svg>
  )
}

export function IconCheck() {
  return (
    <svg className="glyph" viewBox="0 0 24 24" {...svg} strokeWidth={2.2}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}
