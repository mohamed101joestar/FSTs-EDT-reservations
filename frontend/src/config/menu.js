import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  Clock,
  DoorOpen,
  GitBranch,
  History,
  Layers,
  LayoutDashboard,
  Repeat,
  Tags,
  TriangleAlert,
  UserCog,
  Users,
} from 'lucide-react'

// `roles` absent = visible pour tous les rôles
export const menu = [
  {
    section: null,
    items: [{ label: 'Tableau de bord', chemin: '/', icone: LayoutDashboard }],
  },
  {
    section: 'Planning',
    items: [
      { label: 'Emplois du temps', chemin: '/edt', icone: CalendarDays },
      { label: 'Salles', chemin: '/salles', icone: DoorOpen },
      { label: 'Créneaux', chemin: '/creneaux', icone: Clock, roles: ['admin'] },
      { label: 'Événements', chemin: '/evenements', icone: Tags, roles: ['admin'] },
    ],
  },
  {
    section: 'Demandes',
    items: [
      { label: 'Réservations', chemin: '/reservations', icone: ClipboardList },
      { label: 'Demandes de changement', chemin: '/demandes', icone: Repeat },
      { label: 'Conflits', chemin: '/conflits', icone: TriangleAlert, roles: ['admin'] },
    ],
  },
  {
    section: 'Structure académique',
    items: [
      { label: 'Niveaux', chemin: '/niveaux', icone: Layers, roles: ['admin'] },
      { label: 'Filières', chemin: '/filieres', icone: GitBranch, roles: ['admin'] },
      { label: 'Groupes', chemin: '/groupes', icone: Users, roles: ['admin'] },
      { label: 'Modules', chemin: '/modules', icone: BookOpen, roles: ['admin'] },
    ],
  },
  {
    section: 'Administration',
    items: [
      { label: 'Gestion des comptes', chemin: '/utilisateurs', icone: UserCog, roles: ['admin'] },
      { label: 'Historique', chemin: '/historique', icone: History, roles: ['admin'] },
    ],
  },
]

export function menuPourRole(role) {
  return menu
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((s) => s.items.length > 0)
}

// Pages accessibles sans être dans le menu
const pagesHorsMenu = {
  '/notifications': { section: null, label: 'Notifications' },
}

// Sert à afficher le fil d'Ariane et le titre dans l'en-tête
export function trouverPage(chemin) {
  if (pagesHorsMenu[chemin]) return pagesHorsMenu[chemin]
  for (const s of menu) {
    for (const item of s.items) {
      if (item.chemin === chemin) return { section: s.section, label: item.label }
    }
  }
  return { section: null, label: '' }
}

export const libellesRoles = {
  admin: 'Administrateur',
  enseignant: 'Enseignant',
}