import { useId } from 'react'

export default function Input({ label, error, className = '', ...props }) {
  const id = useId()

  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <input
        id={id}
        className={`w-full rounded-lg border bg-white px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-4 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
            : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500/15'
        }`}
        {...props}
      />
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
}