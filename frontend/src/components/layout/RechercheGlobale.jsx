import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, DoorOpen, GitBranch, Search, User, Users } from 'lucide-react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'

// Listes chargées à l'ouverture. Les utilisateurs sont cherchés côté serveur (voir plus bas).
const sources = [
  {
    type: 'Salles',
    icone: DoorOpen,
    url: '/salles',
    chemin: '/salles',
    libelle: (s) => s.nom_salle,
    detail: (s) => `${s.capacite} places`,
  },
  {
    type: 'Modules',
    icone: BookOpen,
    url: '/modules',
    chemin: '/modules',
    roles: ['admin'],
    libelle: (m) => m.nom_module,
    detail: (m) => m.code_module,
  },
  {
    type: 'Filières',
    icone: GitBranch,
    url: '/filieres',
    chemin: '/filieres',
    roles: ['admin'],
    libelle: (f) => f.nom_filiere,
    detail: (f) => f.niveau_libelle,
  },
  {
    type: 'Groupes',
    icone: Users,
    url: '/groupes',
    chemin: '/groupes',
    roles: ['admin'],
    libelle: (g) => g.nom_groupe,
    detail: (g) => g.nom_filiere,
  },
]

// Ignore la casse et les accents : "filiere" trouve "Filière"
const normaliser = (texte) =>
  String(texte ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

export default function RechercheGlobale() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const estAdmin = user.role === 'admin'

  const [ouvert, setOuvert] = useState(false)
  const [requete, setRequete] = useState('')
  const [catalogue, setCatalogue] = useState([])
  const [utilisateurs, setUtilisateurs] = useState([])
  const [actif, setActif] = useState(0)

  const sourcesAutorisees = useMemo(
    () => sources.filter((s) => !s.roles || s.roles.includes(user.role)),
    [user.role]
  )

  const fermer = () => {
    setOuvert(false)
    setRequete('')
    setUtilisateurs([])
    setActif(0)
  }

  // Raccourci Ctrl+K (ou Cmd+K)
  useEffect(() => {
    const surTouche = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOuvert(true)
      }
    }
    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [])

  // À l'ouverture : charge les listes (toujours à jour, c'est quelques requêtes légères)
  useEffect(() => {
    if (!ouvert) return
    let annule = false
    Promise.all(
      sourcesAutorisees.map((s) =>
        api
          .get(s.url)
          .then(({ data }) =>
            data.map((el) => ({
              cle: `${s.type}-${el.id}`,
              groupe: s.type,
              icone: s.icone,
              chemin: s.chemin,
              titre: s.libelle(el),
              detail: s.detail(el),
            }))
          )
          .catch(() => [])
      )
    ).then((listes) => {
      if (!annule) setCatalogue(listes.flat())
    })
    return () => {
      annule = true
    }
  }, [ouvert, sourcesAutorisees])

  // Utilisateurs (admin) : le backend sait déjà chercher, on lui délègue
  useEffect(() => {
    const terme = requete.trim()
    if (!ouvert || !estAdmin || terme.length < 2) return
    let annule = false
    const minuteur = setTimeout(async () => {
      try {
        const { data } = await api.get('/utilisateurs', { params: { recherche: terme, limit: 5 } })
        if (annule) return
        setUtilisateurs(
          data.resultats.map((u) => ({
            cle: `utilisateur-${u.id}`,
            groupe: 'Utilisateurs',
            icone: User,
            chemin: '/utilisateurs',
            titre: `${u.prenom} ${u.nom}`,
            detail: u.email,
          }))
        )
      } catch {
        if (!annule) setUtilisateurs([])
      }
    }, 250)
    return () => {
      annule = true
      clearTimeout(minuteur)
    }
  }, [requete, ouvert, estAdmin])

  const terme = normaliser(requete.trim())

  const resultats = useMemo(() => {
    if (!terme) return []
    const locaux = sourcesAutorisees.flatMap((s) =>
      catalogue
        .filter((e) => e.groupe === s.type && normaliser(`${e.titre} ${e.detail}`).includes(terme))
        .slice(0, 5)
    )
    return requete.trim().length >= 2 ? [...locaux, ...utilisateurs] : locaux
  }, [terme, requete, catalogue, utilisateurs, sourcesAutorisees])

  const choisir = (resultat) => {
    if (!resultat) return
    // Le paramètre ?q servira aux pages de liste pour pré-filtrer
    navigate(`${resultat.chemin}?q=${encodeURIComponent(resultat.titre)}`)
    fermer()
  }

  const surTouche = (e) => {
    if (e.key === 'Escape') fermer()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActif((i) => Math.min(i + 1, resultats.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActif((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      choisir(resultats[actif])
    }
  }

  return (
    <>
      <button
        onClick={() => setOuvert(true)}
        className="hidden w-72 items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-400 hover:border-slate-400 md:flex lg:w-80"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Rechercher…</span>
        <kbd className="rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-500">
          Ctrl K
        </kbd>
      </button>
      <button
        onClick={() => setOuvert(true)}
        aria-label="Rechercher"
        className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>

      {ouvert && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
          <div className="absolute inset-0 bg-slate-900/50" onClick={fermer} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Recherche"
            className="relative w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-slate-100 px-4">
              <Search className="h-5 w-5 shrink-0 text-slate-400" />
              <input
                autoFocus
                value={requete}
                onChange={(e) => {
                  setRequete(e.target.value)
                  setActif(0)
                }}
                onKeyDown={surTouche}
                placeholder={
                  estAdmin ? 'Salle, module, filière, groupe, utilisateur…' : 'Rechercher une salle…'
                }
                className="w-full py-4 text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <kbd className="rounded border border-slate-300 px-1.5 text-xs text-slate-500">Échap</kbd>
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              {!terme ? (
                <p className="px-3 py-8 text-center text-sm text-slate-500">
                  Tapez pour lancer la recherche.
                </p>
              ) : resultats.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-slate-500">
                  Aucun résultat pour « {requete.trim()} ».
                </p>
              ) : (
                resultats.map((r, i) => {
                  const Icone = r.icone
                  return (
                    <div key={r.cle}>
                      {(i === 0 || resultats[i - 1].groupe !== r.groupe) && (
                        <p className="mt-2 px-3 pb-1 text-xs font-semibold text-slate-400 first:mt-0">
                          {r.groupe}
                        </p>
                      )}
                      <button
                        onClick={() => choisir(r)}
                        onMouseEnter={() => setActif(i)}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${
                          i === actif ? 'bg-brand-50' : ''
                        }`}
                      >
                        <Icone className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="flex-1 truncate text-sm text-slate-800">{r.titre}</span>
                        <span className="truncate text-xs text-slate-500">{r.detail}</span>
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}