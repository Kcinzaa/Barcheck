import { useParams } from 'react-router-dom'

export default function BarReport() {
  const { barId, date } = useParams()
  return (
    <main className="page" data-testid="bar-report">
      <h1>Report</h1>
      <p>
        {barId} · {date}
      </p>
    </main>
  )
}
