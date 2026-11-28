import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ ouvert, onFermer, titre, children, pied }) {
  useEffect(() => {
    if (!ouvert) return
    const surTouche = (e) => e.key === 'Escape' && onFermer()
    document.addEventListener('keydown', surTouche)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', surTouche)
      document.body.style.overflow = ''
    }
  }, [ouvert, onFermer])

  if (!ouvert) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onFermer} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className="relative w-full max-w-lg rounded-xl bg-white shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">{titre}</h2>
          <button
            onClick={onFermer}
            aria-label="Fermer"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
        {pied && (
          <footer className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">{pied}</footer>
        )}
      </div>
    </div>
  )
}