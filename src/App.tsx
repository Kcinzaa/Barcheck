import { Route, Routes } from 'react-router-dom'
import Home from './pages/Home'
import BarReport from './pages/BarReport'
import Requisition from './pages/Requisition'
import Monthly from './pages/Monthly'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/bar/:barId/:date/report" element={<BarReport />} />
      <Route path="/bar/:barId/:date/requisition" element={<Requisition />} />
      <Route path="/monthly" element={<Monthly />} />
    </Routes>
  )
}
