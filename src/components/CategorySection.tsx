import { useState, type ReactNode } from 'react'

interface Props {
  title: string
  count: number
  /** Force open (e.g. while searching) regardless of the user's toggle. */
  forceOpen?: boolean
  children: ReactNode
}

/** Collapsible category group; expanded by default. Children are not rendered while collapsed. */
export default function CategorySection({ title, count, forceOpen = false, children }: Props) {
  const [open, setOpen] = useState(true)
  const expanded = forceOpen || open
  const id = `cat-${title.replace(/[^a-z0-9]+/gi, '-')}`

  return (
    <section className="cat">
      <h2 className="cat-head">
        <button
          type="button"
          className="cat-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          disabled={forceOpen}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="cat-title">
            {title}{' '}
            <span className="cat-count">
              <span className="vh">(</span>
              {count}
              <span className="vh">)</span>
            </span>
          </span>
          <span className="chev" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </button>
      </h2>
      {expanded && (
        <div id={id} className="item-grid">
          {children}
        </div>
      )}
    </section>
  )
}
