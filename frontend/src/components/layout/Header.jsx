import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, LogOut, Menu } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { libellesRoles, trouverPage } from '../../config/menu'
import { Badge } from '../ui'
import RechercheGlobale from './RechercheGlobale'

export default function Header({ onOuvrirMenu }) {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const page = trouverPage(pathname)
  const [nonLues, setNonLues] = useState(0)

  // Nombre de notifications non lues, rafraîchi chaque minute
  useEffect(() => {
    let actif = true
    const charger = async () => {
      try {
        const { data } = await api.get('/notifications/non-lues')
        if (actif) setNonLues(data.non_lues ?? 0)
      } catch {
        // silencieux : la cloche reste simplement sans pastille
      }
    }
    charger()
    const minuteur = setInterval(charger, 60000)
    return () => {
      actif = false
      clearInterval(minuteur)
    }
  }, [])

  const initiales = `${user.prenom?.[0] ?? ''}${user.nom?.[0] ?? ''}`.toUpperCase()

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6 lg:px-8">
      {/* Gauche : menu mobile + fil d'Ariane et titre */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          onClick={onOuvrirMenu}
          aria-label="Ouvrir le menu"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="min-w-0 leading-tight">
          {page.section && <p className="truncate text-xs text-slate-500">{page.section}</p>}
          <p className="truncate font-semibold text-slate-900">{page.label}</p>
        </div>
      </div>

      {/* Centre : recherche */}
      <div className="shrink-0">
        <RechercheGlobale />
      </div>

      {/* Droite : notifications et profil */}
      <div className="flex flex-1 items-center justify-end gap-2 sm:gap-4">
        <Link
          to="/notifications"
          aria-label="Notifications"
          className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        >
          <Bell className="h-5 w-5" />
          {nonLues > 0 && (
            <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-500 px-1 text-[10px] font-bold text-brand-900">
              {nonLues > 9 ? '9+' : nonLues}
            </span>
          )}
        </Link>

        <div className="flex items-center gap-3 border-l border-slate-200 pl-2 sm:pl-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
            {initiales}
          </span>
          <div className="hidden text-sm leading-tight xl:block">
            <p className="font-semibold text-slate-900">
              {user.prenom} {user.nom}
            </p>
            <Badge variant={user.role === 'admin' ? 'warning' : 'info'}>
              {libellesRoles[user.role] ?? user.role}
            </Badge>
          </div>
          <button
            onClick={logout}
            aria-label="Se déconnecter"
            title="Se déconnecter"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  )
}