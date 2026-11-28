import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

export default function Layout() {
  const [menuOuvert, setMenuOuvert] = useState(false)

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar ouvert={menuOuvert} onFermer={() => setMenuOuvert(false)} />
      <div className="lg:pl-64">
        <Header onOuvrirMenu={() => setMenuOuvert(true)} />
        <main className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}