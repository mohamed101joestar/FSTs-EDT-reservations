import { Hammer } from 'lucide-react'

export default function PageEnConstruction() {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-100 text-amber-700">
        <Hammer className="h-7 w-7" />
      </span>
      <p className="mt-4 font-semibold text-slate-800">Page en construction</p>
      <p className="mt-1 text-sm text-slate-500">Ce module sera disponible prochainement.</p>
    </div>
  )
}