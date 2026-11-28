import { NavLink } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { menuPourRole } from '../../config/menu'
import Logo from '../Logo'

export default function Sidebar({ ouvert, onFermer }) {
  const { user } = useAuth()
  const sections = menuPourRole(user.role)

  return (
    <>
      {ouvert && (
        <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={onFermer} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-brand-900 text-white transition-transform lg:translate-x-0 ${
          ouvert ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <div className="rounded-xl bg-white p-2">
            <Logo className="h-9" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">Plateforme Planning</p>
            <p className="text-xs text-brand-100">FST Settat</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.section ?? 'principal'} className="mb-5">
              {section.section && (
                <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-brand-100/60">
                  {section.section}
                </p>
              )}
              <ul className="space-y-1">
                {section.items.map(({ label, chemin, icone: Icone }) => (
                  <li key={chemin}>
                    <NavLink
                      to={chemin}
                      end={chemin === '/'}
                      onClick={onFermer}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg border-l-4 px-3 py-2.5 text-sm font-medium transition ${
                          isActive
                            ? 'border-accent-400 bg-white/10 text-white'
                            : 'border-transparent text-brand-100 hover:bg-white/5 hover:text-white'
                        }`
                      }
                    >
                      <Icone className="h-5 w-5 shrink-0" />
                      {label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <p className="border-t border-white/10 px-5 py-4 text-xs text-brand-100/60">
          © 2026 FST Settat
        </p>
      </aside>
    </>
  )
}