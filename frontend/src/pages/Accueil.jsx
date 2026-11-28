import { useAuth } from '../context/AuthContext'

export default function Accueil() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <h1 className="text-2xl font-bold text-gray-800">
        Bienvenue {user.prenom} {user.nom}
      </h1>
      <p className="text-gray-600 mt-1">Rôle : {user.role}</p>
      <button
        onClick={logout}
        className="mt-4 bg-gray-800 text-white rounded-lg px-4 py-2 hover:bg-gray-900"
      >
        Se déconnecter
      </button>
    </div>
  )
}