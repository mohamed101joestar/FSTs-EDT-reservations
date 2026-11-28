import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  Bell,
  CalendarDays,
  DoorOpen,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'

const atouts = [
  { icone: DoorOpen, texte: 'Réservez une salle en quelques clics' },
  { icone: CalendarDays, texte: 'Consultez les emplois du temps en temps réel' },
  { icone: Bell, texte: 'Soyez notifié de chaque changement' },
]

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [afficher, setAfficher] = useState(false)
  const [erreur, setErreur] = useState('')
  const [chargement, setChargement] = useState(false)

  // Déjà connecté : pas besoin de voir le login
  if (user) return <Navigate to="/" replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErreur('')
    setChargement(true)
    try {
      await login(email, motDePasse)
      navigate('/', { replace: true })
    } catch (err) {
      setErreur(err.response?.data?.message || 'Impossible de contacter le serveur.')
    } finally {
      setChargement(false)
    }
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Panneau institutionnel */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-linear-to-br from-brand-900 via-brand-800 to-brand-600 p-12 text-white">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-white/5" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-white/5" />

        <div className="relative inline-flex w-fit rounded-2xl bg-white p-4 shadow-lg">
          <Logo className="h-14" />
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">
            Gestion des salles et des emplois du temps
          </h1>
          <p className="mt-4 text-brand-100">
            Faculté des Sciences et Techniques de Settat
            <br />
            Université Hassan Ier
          </p>

          <ul className="mt-10 space-y-4">
            {atouts.map(({ icone: Icone, texte }) => (
              <li key={texte} className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                  <Icone className="h-5 w-5" />
                </span>
                <span className="text-sm text-brand-50">{texte}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-brand-100/80">© 2026 FST Settat</p>
      </aside>

      {/* Formulaire */}
      <main className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center lg:hidden">
            <Logo className="h-16" />
          </div>

          <h2 className="text-3xl font-bold text-slate-900">Bon retour</h2>
          <p className="mt-2 text-slate-500">
            Connectez-vous avec votre compte pour accéder à la plateforme.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {erreur && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{erreur}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Adresse email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="prenom.nom@exemple.ma"
                  className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-3 text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
                />
              </div>
            </div>

            <div>
              <label htmlFor="motDePasse" className="mb-1.5 block text-sm font-medium text-slate-700">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="motDePasse"
                  type={afficher ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-10 pr-11 text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15"
                />
                <button
                  type="button"
                  onClick={() => setAfficher(!afficher)}
                  aria-label={afficher ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {afficher ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={chargement}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-4 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {chargement && <Loader2 className="h-5 w-5 animate-spin" />}
              {chargement ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <p className="mt-8 text-center text-sm text-slate-500">
            Pas de compte ? Contactez l'administration pour en obtenir un.
          </p>
        </div>
      </main>
    </div>
  )
}