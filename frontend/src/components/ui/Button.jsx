import { Loader2 } from 'lucide-react'

const variantes = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 focus:ring-brand-500/30',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:ring-slate-400/30',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30',
  ghost: 'text-slate-600 hover:bg-slate-100 focus:ring-slate-400/30',
}

const tailles = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2.5',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icone,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-semibold shadow-sm transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${variantes[variant]} ${tailles[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icone && <Icone className="h-4 w-4" />}
      {children}
    </button>
  )
}