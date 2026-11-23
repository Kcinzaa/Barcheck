import { useParams } from 'react-router-dom'

export default function Requisition() {
  const { barId, date } = useParams()
  return (
    <main className="page" data-testid="requisition">
      <h1>Requisition</h1>
      <p>
        {barId} · {date}
      </p>
    </main>
  )
}
