import { useState } from 'react'
import { GraduationCap } from 'lucide-react'

export default function Logo({ className = 'h-14' }) {
  const [absent, setAbsent] = useState(false)

  if (absent) {
    return <GraduationCap className={`${className} text-brand-700`} />
  }

  return (
    <img
      src="/logo-fsts.png"
      alt="Faculté des Sciences et Techniques de Settat"
      className={`${className} w-auto object-contain`}
      onError={() => setAbsent(true)}
    />
  )
}