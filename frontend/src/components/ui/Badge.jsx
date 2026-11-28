const variantes = {
  neutral: 'bg-slate-100 text-slate-700',
  info: 'bg-brand-100 text-brand-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-accent-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
}

export default function Badge({ variant = 'neutral', children }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${variantes[variant]}`}>
      {children}
    </span>
  )
}