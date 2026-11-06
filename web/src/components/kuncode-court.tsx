/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useEffect, useRef, type ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface KunCodeCourtProps {
  children: ReactNode
  className?: string
}

export function KunCodeCourt(props: KunCodeCourtProps) {
  const glowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const moveGlow = (event: PointerEvent) => {
      const glow = glowRef.current
      if (!glow) return
      glow.style.transform = `translate3d(${event.clientX - 210}px, ${event.clientY - 210}px, 0)`
    }

    window.addEventListener('pointermove', moveGlow, { passive: true })
    return () => window.removeEventListener('pointermove', moveGlow)
  }, [])

  return (
    <div
      className={cn(
        'relative min-h-svh overflow-x-clip bg-[#fdf8f3] text-[#1a1a1a] dark:bg-[#15120f] dark:text-[#faf7f2]',
        props.className
      )}
    >
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 [background-image:linear-gradient(90deg,rgba(193,84,27,0.045)_1px,transparent_1px),linear-gradient(rgba(193,84,27,0.045)_1px,transparent_1px)] [background-size:40px_40px] opacity-80 dark:opacity-30'
      />
      <div
        ref={glowRef}
        aria-hidden='true'
        className='pointer-events-none fixed top-0 left-0 z-0 hidden size-[420px] rounded-full [background:radial-gradient(circle,rgba(249,115,22,0.13)_0%,transparent_70%)] md:block dark:[background:radial-gradient(circle,rgba(249,115,22,0.2)_0%,transparent_70%)]'
      />
      <div className='relative z-10'>{props.children}</div>
    </div>
  )
}
